###############################################################################
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
###############################################################################


import sys, dbus, json

from twisted.internet import glib2reactor
# Configure the twisted mainloop to be run inside the glib mainloop.
# This must be done before importing the other twisted modules
glib2reactor.install()
from twisted.internet import reactor, defer

from autobahn.websocket import listenWS
from autobahn.wamp import exportRpc, WampServerFactory, WampServerProtocol

from dbus.mainloop.glib import DBusGMainLoop

import gobject
gobject.threads_init()

from dbus import glib
glib.init_threads()

# enable debug log
from twisted.python import log
log.startLogging(sys.stdout)



###############################################################################
def hashId(senderName, objectName, interfaceName, signalName):
	return senderName + "#" + objectName + "#" + interfaceName + "#" + signalName



###############################################################################
class DbusSignalHandler:
	def __init__(self, bus, senderName, objectName, interfaceName, signalName):
		# publish hash id
		self.id = hashId(senderName, objectName, interfaceName, signalName)
        # connect dbus proxy object to signal
		self.object = bus.get_object(senderName, objectName)
		self.object.connect_to_signal(signalName, self.handleSignal, interfaceName)


	def handleSignal(self, *args):
		# publish dbus args under topic hash id
		factory.dispatch(self.id, json.dumps(args))


###############################################################################
class DbusCallHandler:
	def __init__(self, method, args):
        # deferred reply to return dbus results
		self.pending = False
		self.request = defer.Deferred()
		self.method = method
		self.args = args


	def callMethod(self):
		# dbus method async call
		self.pending = True
		self.method(*self.args, reply_handler=self.dbusSuccess, error_handler=self.dbusError)
		return self.request


	def dbusSuccess(self, *result):
		# return JSON string result array
		self.request.callback(json.dumps(result))
		self.pending = False


	def dbusError(self, error):
		# return dbus error message
		self.request.errback(error.get_dbus_message())
		self.pending = False



###############################################################################
class CloudeebusService:
    def __init__(self):
    	# signal handlers
    	self.signalHandlers = {}
        # pending dbus calls
        self.pendingCalls = []


    @exportRpc
    def dbusRegister(self, list):
    	# read arguments list by position
        if len(list) < 5:
        	raise Exception("Error: expected arguments: bus, sender, object, interface, signal)")
        
    	# check if a handler exists
        sigId = hashId(list[1], list[2], list[3], list[4])
        if self.signalHandlers.has_key(sigId):
        	return sigId
    	
        if list[0] == "session":
        	bus = dbus.SessionBus()
        elif list[0] == "system":
        	bus = dbus.SystemBus()
        else:
        	raise Exception("Error: invalid bus: %s" % list[0])
        
        # create a handler that will publish the signal
        dbusSignalHandler = DbusSignalHandler(bus, list[1], list[2], list[3], list[4])
        self.signalHandlers[sigId] = dbusSignalHandler
        
        return dbusSignalHandler.id


    @exportRpc
    def dbusSend(self, list):
    	# clear pending calls
    	for call in self.pendingCalls:
    		if not call.pending:
    			self.pendingCalls.remove(call)
    	
    	# read arguments list by position
        if len(list) < 5:
        	raise Exception("Error: expected arguments: bus, destination, object, interface, message, [args])")
        if list[0] == "session":
        	bus = dbus.SessionBus()
        elif list[0] == "system":
        	bus = dbus.SystemBus()
        else:
        	raise Exception("Error: invalid bus: %s" % list[0])
        
        # parse JSON arg list
        args = []
        if len(list) == 6:
         	args = json.loads(list[5])
        
        # get dbus proxy
        object = bus.get_object(list[1], list[2])
        method = object.get_dbus_method(list[4], list[3])
        
        # use a deferred call handler to manage dbus results
        dbusCallHandler = DbusCallHandler(method, args)
        self.pendingCalls.append(dbusCallHandler)
        return dbusCallHandler.callMethod()



###############################################################################
class CloudeebusServerProtocol(WampServerProtocol):
	def onSessionOpen(self):
		# create cloudeebus service instance
		self.cloudeebusService = CloudeebusService()
		# register it for RPC
		self.registerForRpc(self.cloudeebusService)
		# register for Publish / Subscribe
		self.registerForPubSub("", True)



###############################################################################
if __name__ == '__main__':
	port = "9000"
	if len(sys.argv) == 2:
		port = sys.argv[1]

	uri = "ws://localhost:" + port

	factory = WampServerFactory(uri, debugWamp = True)
	factory.protocol = CloudeebusServerProtocol
	factory.setProtocolOptions(allowHixie76 = True)

	listenWS(factory)

	DBusGMainLoop(set_as_default=True)

	reactor.run()

