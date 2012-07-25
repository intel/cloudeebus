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


import sys, dbus

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
if __name__ == '__main__':
	port = "9000"
	if len(sys.argv) == 2:
		port = sys.argv[1]

	uri = "ws://localhost:" + port
	print uri
