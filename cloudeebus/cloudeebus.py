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
# Frederic Paut <frederic.paut@intel.com>
#


import argparse, dbus, json, sys

from twisted.internet import glib2reactor
# Configure the twisted mainloop to be run inside the glib mainloop.
# This must be done before importing the other twisted modules
glib2reactor.install()
from twisted.internet import reactor

from autobahn.websocket import listenWS
from autobahn.wamp import WampServerFactory, WampCraServerProtocol

from dbus.mainloop.glib import DBusGMainLoop

import gobject
gobject.threads_init()

from dbus import glib
glib.init_threads()

# enable debug log
from twisted.python import log

###############################################################################

from cloudeebusengine import VERSION, SERVICELIST, CloudeebusService, cache
import cloudeebusengine

OPENDOOR = False
CREDENTIALS = {}
WHITELIST = []
NETMASK =  []

###############################################################################
def ipV4ToHex(mask):
    ## Convert an ip or an IP mask (such as ip/24 or ip/255.255.255.0) in hex value (32bits)
    maskHex = 0
    byte = 0
    if mask.rfind(".") == -1:
        if (int(mask) < 32):
            maskHex = (2**(int(mask))-1)
            maskHex = maskHex << (32-int(mask))
        else:
            raise Exception("Illegal mask (larger than 32 bits) " + mask)
    else:
        maskField = mask.split(".")
        # Check if mask has four fields (byte)
        if len(maskField) != 4:
            raise Exception("Illegal ip address / mask (should be 4 bytes) " + mask)
        for maskQuartet in maskField:
            byte = int(maskQuartet)
            # Check if each field is really a byte
            if byte > 255:
                raise Exception("Illegal ip address / mask (digit larger than a byte) " + mask)              
            maskHex += byte
            maskHex = maskHex << 8
        maskHex = maskHex >> 8
    return maskHex

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
         return {'permissions': extra.get("permissions", None),
                 'authextra': extra.get("authextra", None),
                 'services': extra.get("services", None)}   
    
    def getAuthSecret(self, key):
        secret = CREDENTIALS.get(key, None)
        if secret is None:
            return None
        # secret must be of str type to be hashed
        return str(secret)
    

    def onAuthenticated(self, key, permissions):
        if not OPENDOOR:
            # check net filter
            if NETMASK != []:
                ipAllowed = False
                for netfilter in NETMASK:
                    ipHex=ipV4ToHex(self.peer.host)
                    ipAllowed = (ipHex & netfilter['mask']) == netfilter['ipAllowed'] & netfilter['mask']
                    if ipAllowed:
                        break
                if not ipAllowed:
                    raise Exception("host " + self.peer.host + " is not allowed!")
            # check authentication key
            if key is None:
                raise Exception("Authentication failed")
            # check permissions, array.index throws exception
            if (permissions['permissions'] != None):
                for req in permissions['permissions']:
                    WHITELIST.index(req);
            # check allowed service creation, array.index throws exception
            if (permissions['services'] != None):
                for req in permissions['services']:
                    SERVICELIST.index(req);
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
        help='path to whitelist file (DBus services to use)')
    parser.add_argument('-s', '--servicelist',
        help='path to servicelist file (DBus services to export)')
    parser.add_argument('-n', '--netmask',
        help='netmask,IP filter (comma separated.) eg. : -n 127.0.0.1,192.168.2.0/24,10.12.16.0/255.255.255.0')
    
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
        WHITELIST.extend(json.load(jfile))
        jfile.close()
        
    if args.servicelist:
        jfile = open(args.servicelist)
        SERVICELIST.extend(json.load(jfile))
        jfile.close()
        
    if args.netmask:
        iplist = args.netmask.split(",")
        for ip in iplist:
            if ip.rfind("/") != -1:
                ip=ip.split("/")
                ipAllowed = ip[0]
                mask = ip[1]
            else:
                ipAllowed = ip
                mask = "255.255.255.255" 
            NETMASK.append( {'ipAllowed': ipV4ToHex(ipAllowed), 'mask' : ipV4ToHex(mask)} )

    uri = "ws://localhost:" + args.port
    
    factory = WampServerFactory(uri, debugWamp = args.debug)
    factory.protocol = CloudeebusServerProtocol
    factory.setProtocolOptions(allowHixie76 = True)

    # Configure cloudeebus engine for WAMP.
    cloudeebusengine.factory = factory
    cloudeebusengine.OPENDOOR = OPENDOOR

    listenWS(factory)
    
    DBusGMainLoop(set_as_default=True)
    
    reactor.run()
