###############################################################################
##
##  Copyright 2011,2012 Tavendo GmbH
##
##  Licensed under the Apache License, Version 2.0 (the "License");
##  you may not use this file except in compliance with the License.
##  You may obtain a copy of the License at
##
##      http://www.apache.org/licenses/LICENSE-2.0
##
##  Unless required by applicable law or agreed to in writing, software
##  distributed under the License is distributed on an "AS IS" BASIS,
##  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
##  See the License for the specific language governing permissions and
##  limitations under the License.
##
###############################################################################

import sys, dbus
from twisted.python import log

# Configure the twisted mainloop to be run inside the glib mainloop.
# glib2reactor is the reactor using the glib mainloop.
from twisted.internet import glib2reactor
glib2reactor.install()

from twisted.internet import glib2reactor, reactor, defer
from autobahn.websocket import listenWS
from autobahn.wamp import exportRpc, WampServerFactory, WampServerProtocol

from dbus.mainloop.glib import DBusGMainLoop

import gobject
gobject.threads_init()

from dbus import glib
glib.init_threads()

###############################################################################
class DbusTestService:
    """
    A simple service we will export for Remote Procedure Calls (RPC).
    All you need to do is use the @exportRpc decorator on methods you want to provide for RPC and register a class instance in the
    server factory (see below).
    The method will be exported under the Python method name.
    """
    def handle_notification(self, id, reason):
        print "Notification Closed Signal: id=%s, reason=%s" % (id, reason)
        
    @exportRpc
    def myFunc(self, list):
        # raise Exception("http://cloudybus.com/error#invalid_numbers one or more numbers are multiples of 3", errs)
        
        """send a desktop notification using dbus."""
        self.icon = ("/usr/share/icons/ubuntu-mono-light/status/24/user-offline-panel.svg")
        self.notification = dbus.Interface(self.obj, "org.freedesktop.Notifications")
        result = self.notification.Notify("Application Name", 0, self.icon, "Title", "The body.", "", "", 0)
        print "Notification SENT: id=%s" % result
        return str(result)

    @exportRpc
    def myAsyncFunc(self, list):
        self.bus = dbus.SessionBus()
        self.obj = self.bus.get_object("org.freedesktop.Notifications", "/org/freedesktop/Notifications")
        
        print "Introspection data:"
        print self.obj.Introspect()
        
        # Setup a Dbus notification signal handler
        self.obj.connect_to_signal("NotificationClosed", self.handle_notification)
        
        # Simulate a slow function.
        request = defer.Deferred()
        reactor.callLater(3, request.callback, self.myFunc(list))
        # Publish Signal
        factory.dispatch("http://cloudybus.com/MyDbus#signal1", {"data": "hello signal 1"})
        factory.dispatch("http://cloudybus.com/MyDbus#signal2", {"data": "hello signal 2"})
        return request

###############################################################################
class SimpleServerProtocol(WampServerProtocol):
    """
    Demonstrates creating a simple server with Autobahn WebSockets that responds to RPC calls.
    """
    def onSessionOpen(self):
        # when connection is established, we create our service instances and register them for RPC. that's it.
        self.dbusTestSrv = DbusTestService()
        self.registerForPubSub("http://cloudybus.com/MyDbus#", True)
        self.registerForRpc(self.dbusTestSrv, "http://cloudybus.com/MyDbus#")

###############################################################################
if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'debug':
        log.startLogging(sys.stdout)
        debug = True
    else:
        debug = False

    factory = WampServerFactory("ws://localhost:9000", debugWamp = debug)
    factory.protocol = SimpleServerProtocol
    factory.setProtocolOptions(allowHixie76 = True)
    listenWS(factory)

    DBusGMainLoop(set_as_default=True)
        
    reactor.run()
