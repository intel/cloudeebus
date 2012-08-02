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
class DbusSignalHandler:
	def __init__(self, bus, senderName, objectName, interfaceName, signalName):
		# publish hash id
		self.id = senderName + "#" + objectName + "#" + interfaceName + "#" + signalName
        # connect dbus proxy object to signal
		self.object = bus.get_object(senderName, objectName)
		self.object.connect_to_signal(signalName, self.handleSignal, interfaceName)


	def handleSignal(self, *args):
		print "---- got signal:"
		print self.id
		print args
		# publish dbus args under topic hash id
		factory.dispatch(self.id, json.dumps(args))



###############################################################################
class DbusRegisterService:
    def __init__(self):
    	# signal handlers
    	self.signalHandlers = []


    @exportRpc
    def dbusRegister(self, list):
    	# read arguments list by position
        if len(list) < 5:
        	raise Exception("Error: expected arguments: bus, sender, object, interface, signal)")
        if list[0] == "session":
        	bus = dbus.SessionBus()
        elif list[0] == "system":
        	bus = dbus.SystemBus()
        else:
        	raise Exception("Error: invalid bus: %s" % list[0])
        
        # create a handler that will publish the signal
        dbusSignalHandler = DbusSignalHandler(bus, list[1], list[2], list[3], list[4])
        self.signalHandlers.append(dbusSignalHandler)
        
        return dbusSignalHandler.id



###############################################################################
class DbusRegisterServerProtocol(WampServerProtocol):
	def onSessionOpen(self):
		# create dbus-register service instance
		self.DbusRegisterService = DbusRegisterService()
		# register it for RPC
		self.registerForRpc(self.DbusRegisterService)
		# register for Publish / Subscribe
		self.registerForPubSub("", True)



###############################################################################
if __name__ == '__main__':
	port = "9001"
	if len(sys.argv) == 2:
		port = sys.argv[1]

	uri = "ws://localhost:" + port

	factory = WampServerFactory(uri, debugWamp = True)
	factory.protocol = DbusRegisterServerProtocol
	factory.setProtocolOptions(allowHixie76 = True)

	listenWS(factory)

	DBusGMainLoop(set_as_default=True)

	reactor.run()

