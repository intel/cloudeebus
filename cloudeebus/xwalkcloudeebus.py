# Cloudeebus for Crosswalk
#
# Copyright 2012 Intel Corporation.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Patrick Ohly <patrick.ohly@intel.com>
#

# This is an extension loaded by pycrosswalk. It uses Cloudeebus
# Python in the Crosswalk extension process and Cloudeebus JavaScript
# in the Crosswalk render process, connected via Crosswalk's extension
# message passing instead of the original WebSocket/WAMP.
#
# Installation:
# cloudeebus.js, xwalkcloudeebus.py and cloudeebusengine.py must be installed in
# the same directory. xwalkcloudeebus.py (or a symlink to it) and a
# symlink to libpycrosswalk.so must be in a directory that Crosswalk
# searches for extensions.
#
# To run some examples directly in the cloudeebus source tree:
# ln -s <path to libpycrosswalk.so> cloudeebus/libxwalkcloudeebus.so
# xwalk --external-extensions-path=cloudeebus doc/agent/server.html &
# xwalk --external-extensions-path=cloudeebus doc/agent/client.html &
#
# Only one-way messages are used. RPC method calls contain a sequence
# number that gets repeated in the reply, so the caller can match
# pending calls with their reply.
#
# The message format is JSON:
# [ <type>, ... ]
# <type> = "call" | "reply" | "signal"
# [ "call", <sequence number>, <method name>, [<parameters>] ]
# [ "reply", <call sequence number>, "error string", <result> ]
# [ "signal", <topic>, [<parameters>] ]
# [ "subscribe", <topic> ]
# [ "unsubscribe", <topic> ]

import gi.repository
import sys
import inspect
import json
import time
import traceback
import os
import re

from gi.repository import GLib

from dbus.mainloop.glib import DBusGMainLoop
DBusGMainLoop(set_as_default=True)

from twisted.internet import defer
from twisted.python import log
# enable debug log
#log.startLogging(sys.stdout)

import xwalk

# Configure cloudeebus engine module. Partly has to be done before importing
# because the engine needs to know how it is going to be used.
os.environ['CLOUDEEBUS_XWALK'] = '1'
import cloudeebusengine
cloudeebusengine.OPENDOOR = True # No other process has access, so we need no additional credential checking.

class Factory:
  # Mapping from instance ID to hash with all subscribed topics.
  instances = {}
  def dispatch(self, topic, event):
    for instance, topics in Factory.instances.iteritems():
      if topic in topics:
        xwalk.PostMessage(instance, json.dumps(['signal', topic, event]))

cloudeebusengine.factory = Factory()

service = cloudeebusengine.CloudeebusService({'permissions': [], 'authextra': '', 'services': []})
methods = {}

for method in inspect.getmembers(service.__class__, inspect.ismethod):
  if method[1].__dict__.has_key("_xwalk_rpc_id"):
    name = method[1].__dict__["_xwalk_rpc_id"]
    proc = method[1]
    methods[name] = proc

def HandleMessage(instance, message):
  log.msg('New message: %s' % message)
  content = json.loads(message)
  msgtype = content[0]
  if msgtype == 'call':
    sequencenr = content[1]
    try:
      name = str(content[2])
      params = content[3]
      d = defer.maybeDeferred(methods[name], service, params)
      d.addCallback(lambda result: (log.msg('call %d done: %s' % (sequencenr, result)), xwalk.PostMessage(instance, json.dumps(['reply', sequencenr, '', result]))))
      d.addErrback(lambda error: (log.msg('call %d failed: %s' % (sequencenr, error)), xwalk.PostMessage(instance, json.dumps(['reply', sequencenr, str(error), []]))))
    except Exception, ex:
      log.msg('failed to start call %d: %s' % (sequencenr, traceback.format_exc()));
      xwalk.PostMessage(instance, json.dumps(['reply', sequencenr, repr(ex), []]))
  elif msgtype == 'subscribe':
    topic = content[1]
    log.msg('Subscribing %d to %s' % (instance, topic))
    Factory.instances[instance][topic] = True
  elif msgtype == 'unsubscribe':
    topic = content[1]
    log.msg('Unsubscribing %d from %s' % (instance, topic))
    del Factory.instances[instance][topic]

def HandleInstanceCreated(instance):
  Factory.instances[instance] = {}
  xwalk.SetMessageCallback(instance, HandleMessage)

def HandleInstanceDestroyed(instance):
  del Factory.instances[instance]

def Main():
  xwalk.SetExtensionName("cloudeebus")
  xwalk.SetInstanceCreatedCallback(HandleInstanceCreated)
  xwalk.SetInstanceDestroyedCallback(HandleInstanceDestroyed)

  # cloudeebus.js is expected in the same directory as the actual
  # xwalkcloudeebus.py file (i.e., after resolving symlinks).
  modpath = inspect.getsourcefile(Main)
  modpath = os.path.realpath(modpath)
  jssource = os.path.join(os.path.dirname(modpath), 'cloudeebus.js')

  js = open(jssource).read()

  js = js + '''
    var pending_calls = {};
    var topics = {};
    var call_counter = 1;

    // A pending call behaves like a Promise: the instance
    // gets stored in the pending hash, is returned by call(),
    // and then the caller installs its callbacks with then().
    var Pending = function() {
      this.success = null;
      this.failure = null;
      return this;
    };
    Pending.prototype.then = function(success, failure) {
      this.success = success;
      this.failure = failure;
    };

    // Error instance as used by WAMP error callbacks.
    // Meant to work with cloudeebus.getError().
    var Error = function(description) {
      this.desc = description;
      this.uri = null;
      this.name = null;
      this.message = null;
      return this;
    };

    extension.setMessageListener(function(msg) {
      var msg_content = JSON.parse(msg);
      if (msg_content[0] == "reply") {
        // Handle message reply.
        var pending = pending_calls[msg_content[1]];
        delete pending_calls[msg_content[1]];
        if (msg_content[2] != "") {
          if (pending.failure) {
            pending.failure(msg_content[2]);
          }
        } else {
          if (pending.success) {
            pending.success(msg_content[3]);
          }
        }
      }
      if (msg_content[0] == "signal") {
        // Handle signal.
        var topic = msg_content[1];
        var args = msg_content[2];
        var handler = topics[topic];
        if (handler) {
          handler(topic, args);
        }
      }
    });

    // Emulate WAMPSession.
    var Session = function() {
      this.extension = extension;
      return this;
    };
    Session.prototype.call = function(method, args) {
      var message = [ "call", call_counter, method, args ];
      var data = JSON.stringify(message);
      var pending = new Pending();
      pending_calls[call_counter] = pending;
      this.extension.postMessage(data);
      call_counter++;
      return pending;
    };
    Session.prototype.subscribe = function(topic, handler) {
      var message = [ "subscribe", topic ]
      var data = JSON.stringify(message);
      this.extension.postMessage(data);
      topics[topic] = handler;
    }
    Session.prototype.unsubscribe = function(topic) {
      var message = [ "unsubscribe", topic ]
      var data = JSON.stringify(message);
      this.extension.postMessage(data);
      delete topics[topic];
    }
    var session = new Session();

    exports.connect = function(uri, manifest, successCB, errorCB) {
      cloudeebus.reset();
      cloudeebus.sessionBus = new cloudeebus.BusConnection("session", session);
      cloudeebus.systemBus = new cloudeebus.BusConnection("system", session);
      successCB();
    };
    exports.SessionBus = cloudeebus.SessionBus;
    exports.SystemBus = cloudeebus.SystemBus;
    exports.reset = cloudeebus.reset;
    exports.Agent = cloudeebus.Agent;
    exports.Service = cloudeebus.Service;
    exports.ProxyObject = cloudeebus.ProxyObject;
    exports.Promise = cloudeebus.Promise;
'''

  xwalk.SetJavaScriptAPI(js)

Main()
