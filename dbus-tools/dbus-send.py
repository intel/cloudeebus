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


###############################################################################
class DbusSendService:
    @exportRpc
    def dbusSend(self, list):
        if len(list) < 4:
        	print "expected arguments: bus, destination, object, message, [args])"
        	return "Error: wrong arguments"
        if list[0] == "session":
        	self.bus = dbus.SessionBus()
        elif list[0] == "system":
        	self.bus = dbus.SystemBus()
        else:
        	print "invalid bus: %s" % list[0]
        	return "Error: invalid bus"
        
        self.args = []
        if len(list) == 5:
         	self.args = json.loads(list[4])
        
        self.object = self.bus.get_object(list[1], list[2])
        self.method = self.object.get_dbus_method(list[3])
        
        result = self.method(*self.args)
        return json.dumps(result)


###############################################################################
class DbusSendServerProtocol(WampServerProtocol):
	def onSessionOpen(self):
		# create dbus-send service instance and register it for RPC.
		self.dbusSendService = DbusSendService()
		self.registerForRpc(self.dbusSendService)


###############################################################################
if __name__ == '__main__':
	port = "9000"
	if len(sys.argv) == 2:
		port = sys.argv[1]

	uri = "ws://localhost:" + port

	factory = WampServerFactory(uri, debugWamp = True)
	factory.protocol = DbusSendServerProtocol
	factory.setProtocolOptions(allowHixie76 = True)

	listenWS(factory)

	DBusGMainLoop(set_as_default=True)

	reactor.run()

