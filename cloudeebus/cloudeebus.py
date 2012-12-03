#!/usr/bin/env python

# Cloudeebus
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
# Luc Yriarte <luc.yriarte@intel.com>
# Christophe Guiraud <christophe.guiraud@intel.com>
#


import argparse, dbus, json, sys

from twisted.internet import glib2reactor
# Configure the twisted mainloop to be run inside the glib mainloop.
# This must be done before importing the other twisted modules
glib2reactor.install()
from twisted.internet import reactor, defer

from autobahn.websocket import listenWS
from autobahn.wamp import exportRpc, WampServerFactory, WampCraServerProtocol

from dbus.mainloop.glib import DBusGMainLoop

import gobject
gobject.threads_init()

from dbus import glib
glib.init_threads()

# enable debug log
from twisted.python import log



###############################################################################

VERSION = "0.2"
OPENDOOR = False
CREDENTIALS = {}
WHITELIST = []

###############################################################################
class DbusCache:
    '''
    Global cache of DBus connexions and signal handlers
    '''
    def __init__(self):
        self.dbusConnexions = {}
        self.signalHandlers = {}


    def reset(self):
        '''
        Disconnect signal handlers before resetting cache.
        '''
        self.dbusConnexions = {}
        # disconnect signal handlers
        for key in self.signalHandlers:
            self.signalHandlers[key].disconnect()
        self.signalHandlers = {}


    def dbusConnexion(self, busName):
        if not self.dbusConnexions.has_key(busName):
            if busName == "session":
                self.dbusConnexions[busName] = dbus.SessionBus()
            elif busName == "system":
                self.dbusConnexions[busName] = dbus.SystemBus()
            else:
                raise Exception("Error: invalid bus: %s" % busName)
        return self.dbusConnexions[busName]



###############################################################################
class DbusSignalHandler:
    '''
    signal hash id as busName#senderName#objectName#interfaceName#signalName
    '''
    def __init__(self, busName, senderName, objectName, interfaceName, signalName):
        self.id = "#".join([busName, senderName, objectName, interfaceName, signalName])
        # connect handler to signal
        self.bus = cache.dbusConnexion(busName)
        self.bus.add_signal_receiver(self.handleSignal, signalName, interfaceName, senderName, objectName)
        
    
    def disconnect(self):
        names = self.id.split("#")
        self.bus.remove_signal_receiver(self.handleSignal, names[4], names[3], names[1], names[2])


    def handleSignal(self, *args):
        '''
        publish dbus args under topic hash id
        '''
        factory.dispatch(self.id, json.dumps(args))



###############################################################################
class DbusCallHandler:
    '''
    deferred reply to return dbus results
    '''
    def __init__(self, method, args):
        self.pending = False
        self.request = defer.Deferred()
        self.method = method
        self.args = args


    def callMethod(self):
        '''
        dbus method async call
        '''
        self.pending = True
        self.method(*self.args, reply_handler=self.dbusSuccess, error_handler=self.dbusError)
        return self.request


    def dbusSuccess(self, *result):
        '''
        return JSON string result array
        '''
        self.request.callback(json.dumps(result))
        self.pending = False


    def dbusError(self, error):
        '''
        return dbus error message
        '''
        self.request.errback(error.get_dbus_message())
        self.pending = False



###############################################################################
class CloudeebusService:
    '''
    support for sending DBus messages and registering for DBus signals
    '''
    def __init__(self, permissions):
        self.permissions = permissions;
        self.proxyObjects = {}
        self.proxyMethods = {}
        self.pendingCalls = []


    def proxyObject(self, busName, serviceName, objectName):
        '''
        object hash id as busName#serviceName#objectName
        '''
        id = "#".join([busName, serviceName, objectName])
        if not self.proxyObjects.has_key(id):
            if not OPENDOOR:
                # check permissions, array.index throws exception
                self.permissions.index(serviceName)
            bus = cache.dbusConnexion(busName)
            self.proxyObjects[id] = bus.get_object(serviceName, objectName)
        return self.proxyObjects[id]


    def proxyMethod(self, busName, serviceName, objectName, interfaceName, methodName):
        '''
        method hash id as busName#serviceName#objectName#interfaceName#methodName
        '''
        id = "#".join([busName, serviceName, objectName, interfaceName, methodName])
        if not self.proxyMethods.has_key(id):
            obj = self.proxyObject(busName, serviceName, objectName)
            self.proxyMethods[id] = obj.get_dbus_method(methodName, interfaceName)
        return self.proxyMethods[id]


    @exportRpc
    def dbusRegister(self, list):
        '''
        arguments: bus, sender, object, interface, signal
        '''
        if len(list) < 5:
            raise Exception("Error: expected arguments: bus, sender, object, interface, signal)")
        
        if not OPENDOOR:
            # check permissions, array.index throws exception
            self.permissions.index(list[1])
        
        # check if a handler exists
        sigId = "#".join(list)
        if cache.signalHandlers.has_key(sigId):
            return sigId
        
        # create a handler that will publish the signal
        dbusSignalHandler = DbusSignalHandler(*list)
        cache.signalHandlers[sigId] = dbusSignalHandler
        
        return dbusSignalHandler.id


    @exportRpc
    def dbusSend(self, list):
        '''
        arguments: bus, destination, object, interface, message, [args]
        '''
        # clear pending calls
        for call in self.pendingCalls:
            if not call.pending:
                self.pendingCalls.remove(call)
        
        if len(list) < 5:
            raise Exception("Error: expected arguments: bus, destination, object, interface, message, [args])")
        
        # parse JSON arg list
        args = []
        if len(list) == 6:
            args = json.loads(list[5])
        
        # get dbus proxy method
        method = self.proxyMethod(*list[0:5])
        
        # use a deferred call handler to manage dbus results
        dbusCallHandler = DbusCallHandler(method, args)
        self.pendingCalls.append(dbusCallHandler)
        return dbusCallHandler.callMethod()


    @exportRpc
    def getVersion(self):
        '''
        return current version string
        '''
        return VERSION



###############################################################################
class CloudeebusServerProtocol(WampCraServerProtocol):
    '''
    connexion and session authentication management
    '''
    
    def onSessionOpen(self):
        # CRA authentication options
        self.clientAuthTimeout = 0
        self.clientAuthAllowAnonymous = OPENDOOR
        # CRA authentication init
        WampCraServerProtocol.onSessionOpen(self)
    
    
    def getAuthPermissions(self, key, extra):
        return json.loads(extra.get("permissions", "[]"))
    
    
    def getAuthSecret(self, key):
        secret = CREDENTIALS.get(key, None)
        if secret is None:
            return None
        # secret must be of str type to be hashed
        return secret.encode('utf-8')
    

    def onAuthenticated(self, key, permissions):
        if not OPENDOOR:
            # check authentication key
            if key is None:
                raise Exception("Authentication failed")
            # check permissions, array.index throws exception
            for req in permissions:
                WHITELIST.index(req)
        # create cloudeebus service instance
        self.cloudeebusService = CloudeebusService(permissions)
        # register it for RPC
        self.registerForRpc(self.cloudeebusService)
        # register for Publish / Subscribe
        self.registerForPubSub("", True)
    
    
    def connectionLost(self, reason):
        WampCraServerProtocol.connectionLost(self, reason)
        if factory.getConnectionCount() == 0:
            cache.reset()



###############################################################################

if __name__ == '__main__':
    
    cache = DbusCache()

    parser = argparse.ArgumentParser(description='Javascript DBus bridge.')
    parser.add_argument('-v', '--version', action='store_true', 
        help='print version and exit')
    parser.add_argument('-d', '--debug', action='store_true', 
        help='log debug info on standard output')
    parser.add_argument('-o', '--opendoor', action='store_true',
        help='allow anonymous access to all services')
    parser.add_argument('-p', '--port', default='9000',
        help='port number')
    parser.add_argument('-c', '--credentials',
        help='path to credentials file')
    parser.add_argument('-w', '--whitelist',
        help='path to whitelist file')
    
    args = parser.parse_args(sys.argv[1:])

    if args.version:
        print("Cloudeebus version " + VERSION)
        exit(0)
    
    if args.debug:
        log.startLogging(sys.stdout)
    
    OPENDOOR = args.opendoor
    
    if args.credentials:
        jfile = open(args.credentials)
        CREDENTIALS = json.load(jfile)
        jfile.close()
    
    if args.whitelist:
        jfile = open(args.whitelist)
        WHITELIST = json.load(jfile)
        jfile.close()
    
    uri = "ws://localhost:" + args.port
    
    factory = WampServerFactory(uri, debugWamp = args.debug)
    factory.protocol = CloudeebusServerProtocol
    factory.setProtocolOptions(allowHixie76 = True)
    
    listenWS(factory)
    
    DBusGMainLoop(set_as_default=True)
    
    reactor.run()
