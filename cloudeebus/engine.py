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

import dbus
import dbus.service
import os
import re
import json

# enable debug log
from twisted.python import log

# XML parser module
from xml.etree.ElementTree import XMLParser

from twisted.internet import defer

# The user of engine.py must set this to some object
# providing a dispatch(topicUri, event) method as in WampServerFactory
factory = None

if os.environ.get('CLOUDEEBUS_XWALK', False):
    # Same approach as in autobahn.wamp: add the method name to
    # decorated methods, which then gets used to identify the methods
    # that can be called from remote.
    def exportRpc(arg):
        arg._xwalk_rpc_id = arg.__name__
        return arg
else:
    from autobahn.wamp import exportRpc

VERSION = "0.6.0"
OPENDOOR = False
SERVICELIST = []

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

cache = DbusCache()


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
        self.request.errback(Exception(error.get_dbus_message()))
        self.pending = False



################################################################################       
class ExecCode:
    '''
    Execute DynDBusClass generated code
    '''
    def __init__(self, globalCtx, localCtx) :
        self.exec_string = ""
        self.exec_code = None
        self.exec_code_valid = 1
        self.indent_level = 0
        self.indent_increment = 1
        self.line = 0
        self.localCtx = localCtx
        self.globalCtx = globalCtx
        

    def append_stmt(self, stmt) :
        self.exec_code_valid = 0
        self.line += 1
        for x in range(0,self.indent_level):
            self.exec_string = self.exec_string + ' '            
        self.exec_string = self.exec_string + stmt + '\n'

    def indent(self) :
        self.indent_level = self.indent_level + self.indent_increment

    def dedent(self) :
        self.indent_level = self.indent_level - self.indent_increment
    
    # compile : Compile exec_string into exec_code using the builtin
    # compile function. Skip if already in sync.
    def compile(self) :
        if not self.exec_code_valid :
            self.exec_code = compile(self.exec_string, "<string>", "exec")
        self.exec_code_valid = True

    def execute(self) :
        if not self.exec_code_valid :
            self.compile()
        exec(self.exec_code, self.globalCtx, self.localCtx)



################################################################################       
class XmlCbParser: # The target object of the parser
    maxDepth = 0
    depth = 0
    def __init__(self, dynDBusClass):
        self.dynDBusClass = dynDBusClass
        
    def start(self, tag, attrib):   # Called for each opening tag.
        if (tag == 'node'):
            return
        # Set interface name
        if (tag == 'interface'):
            self.dynDBusClass.set_interface(attrib['name'])
            return
        # Set method name
        if (tag == 'method'):
            self.current = tag
            self.dynDBusClass.def_method(attrib['name'])
            return
        if (tag == 'signal'):
            self.current = tag
            self.dynDBusClass.def_signal(attrib['name'])
            return

        # Set signature (in/out & name) for method
        if (tag == 'arg'):
            if (self.current == 'method'):
                if (attrib.has_key('direction') == False):
                    attrib['direction'] = "in"
                self.dynDBusClass.add_signature(attrib['name'],
                                                attrib['direction'],
                                                attrib['type'])
                return
            if (self.current == 'signal'):
                if (attrib.has_key('name') == False):
                    attrib['name'] = 'value'
                self.dynDBusClass.add_signature(attrib['name'], 'in',
                                                attrib['type'])
                return
    def end(self, tag):             # Called for each closing tag.
        if (tag == 'method'):
            self.dynDBusClass.add_dbus_method()
            self.dynDBusClass.add_body_method()
            self.dynDBusClass.end_method()
        if (tag == 'signal'):
            self.dynDBusClass.add_dbus_signal()
            self.dynDBusClass.add_body_signal()
            self.dynDBusClass.end_method()
           
    def data(self, data):
        pass            # We do not need to do anything with data.
    def close(self):    # Called when all data has been parsed.
        return self.maxDepth


       
###############################################################################
def createClassName(objectPath):
    return re.sub('/', '_', objectPath[1:])

################################################################################       
class DynDBusClass():
    def __init__(self, className, globalCtx, localCtx):
        self.xmlCB = XmlCbParser(self)
        self.signature = {}
        self.class_code = ExecCode(globalCtx, localCtx)  
        self.class_code.indent_increment = 4
        self.class_code.append_stmt("import dbus")
        self.class_code.append_stmt("\n")
        self.class_code.append_stmt("class " + className + "(dbus.service.Object):")
        self.class_code.indent()
        
        ## Overload of __init__ method 
        self.def_method("__init__")
        self.add_method("bus, callback=None, objPath='/sample', srvName='org.cloudeebus'")
        self.add_stmt("self.bus = bus")
        self.add_stmt("self.objPath = objPath")
        self.add_stmt("self.srvName = srvName")        
        self.add_stmt("self.callback = callback")        
        self.add_stmt("dbus.service.Object.__init__(self, conn=bus, bus_name=srvName)")
        self.end_method()
               
        ## Create 'add_to_connection' method 
        self.def_method("add_to_connection")
        self.add_method("connection=None, path=None")
        self.add_stmt("dbus.service.Object.add_to_connection(self, connection=self.bus, path=self.objPath)")
        self.end_method()
               
        ## Create 'remove_from_connection' method 
        self.def_method("remove_from_connection")
        self.add_method("connection=None, path=None")
        self.add_stmt("dbus.service.Object.remove_from_connection(self, connection=None, path=self.objPath)")
        self.end_method()
               
    def createDBusServiceFromXML(self, xml):
        self.parser = XMLParser(target=self.xmlCB)
        self.parser.feed(xml)
        self.parser.close()
    
    def set_interface(self, ifName):
        self.ifName = ifName
        
    def def_method(self, methodName):
        self.methodToAdd = methodName
        self.signalToAdd = None
        self.args_str = str()
        self.signature = {}
        self.signature['name'] = str()
        self.signature['in'] = str()                
        self.signature['out'] = str()                        

    def def_signal(self, signalName):
        self.methodToAdd = None
        self.signalToAdd = signalName
        self.args_str = str()
        self.signature = {}
        self.signature['name'] = str()
        self.signature['in'] = str()                
        self.signature['out'] = str()                        

    def add_signature(self, name, direction, signature):
        if (direction == 'in'):
            self.signature['in'] += signature
            if (self.signature['name'] != str()):
                self.signature['name'] += ", "
            self.signature['name'] += name
        if (direction == 'out'):
            self.signature['out'] = signature                        
        
    def add_method(self, args = None, async_success_cb = None, async_err_cb = None):
        async_cb_str = str()
        if (self.methodToAdd != None):
            name = self.methodToAdd
        else:
            name = self.signalToAdd
        if (args != None):
            self.args_str = args
        if (async_success_cb != None):
            async_cb_str = async_success_cb
        if (async_err_cb != None):
            if (async_cb_str != str()):
                async_cb_str += ", "
            async_cb_str += async_err_cb
                        
        parameters = self.args_str
        if (async_cb_str != str()):
            if (parameters != str()):
                parameters += ", "
            parameters +=async_cb_str       
        
        if (parameters != str()):
            self.class_code.append_stmt("def " + name + "(self, %s):" % parameters)               
        else:
            self.class_code.append_stmt("def " + name + "(self):")
        self.class_code.indent()
        
    def end_method(self):
        self.class_code.append_stmt("\n")
        self.class_code.dedent()
        
    def add_dbus_method(self):
        decorator = '@dbus.service.method("' + self.ifName + '"'
        if (self.signature.has_key('in') and self.signature['in'] != str()):
                decorator += ", in_signature='" + self.signature['in'] + "'"
        if (self.signature.has_key('out') and self.signature['out'] != str()):
                decorator += ", out_signature='" + self.signature['out'] + "'"
        decorator += ", async_callbacks=('dbus_async_cb', 'dbus_async_err_cb')"            
        decorator += ")"
        self.class_code.append_stmt(decorator)
        if (self.signature.has_key('name') and self.signature['name'] != str()):
            self.add_method(self.signature['name'], async_success_cb='dbus_async_cb', async_err_cb='dbus_async_err_cb')
        else:
            self.add_method(async_success_cb='dbus_async_cb', async_err_cb='dbus_async_err_cb')

    def add_dbus_signal(self):
        decorator = '@dbus.service.signal("' + self.ifName + '"'
        if (self.signature.has_key('in') and self.signature['in'] != str()):
                decorator += ", signature='" + self.signature['in'] + "'"
        decorator += ")"            
        self.class_code.append_stmt(decorator)
        if (self.signature.has_key('name') and self.signature['name'] != str()):
            self.add_method(self.signature['name'])
        else:
            self.add_method()

    def add_body_method(self):
        if (self.methodToAdd != None):
            if (self.args_str != str()):
                self.class_code.append_stmt("self.callback(self.srvName,'" + self.methodToAdd + "', self.objPath, '"  + self.ifName + "', " + "dbus_async_cb, dbus_async_err_cb, %s)" % self.args_str)
            else:        
                self.class_code.append_stmt("self.callback(self.srvName,'" + self.methodToAdd + "', self.objPath, '"  + self.ifName + "', " + "dbus_async_cb, dbus_async_err_cb)")

    def add_body_signal(self):
        self.class_code.append_stmt("return") ## TODO: Remove and fix with code ad hoc
        self.class_code.append_stmt("\n")

    def add_stmt(self, stmt) :
        self.class_code.append_stmt(stmt)
        
    def declare(self) :
        self.class_code.execute()



###############################################################################
class CloudeebusService:
    '''
    support for sending DBus messages and registering for DBus signals
    '''
    def __init__(self, permissions):
        self.permissions = {};
        self.permissions['permissions'] = permissions['permissions']
        self.permissions['authextra'] = permissions['authextra']
        self.permissions['services'] = permissions['services']
        self.proxyObjects = {}
        self.proxyMethods = {}
        self.pendingCalls = []
        self.dynDBusClasses = {} # DBus class source code generated dynamically (a list because one by classname)
        self.services = {}  # DBus service created
        self.serviceAgents = {} # Instantiated DBus class previously generated dynamically, for now, one by classname
        self.servicePendingCalls = {} # JS methods called (and waiting for a Success/error response), containing 'methodId', (successCB, errorCB)
        self.localCtx = locals()
        self.globalCtx = globals()


    def proxyObject(self, busName, serviceName, objectName):
        '''
        object hash id as busName#serviceName#objectName
        '''
        id = "#".join([busName, serviceName, objectName])
        if not self.proxyObjects.has_key(id):
            if not OPENDOOR:
                # check permissions, array.index throws exception
                self.permissions['permissions'].index(serviceName)
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
            self.permissions['permissions'].index(list[1])
        
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
    def emitSignal(self, list):
        '''
        arguments: agentObjectPath, signalName, args (to emit)
        '''
        objectPath = list[0]
        className = re.sub('/', '_', objectPath[1:])
        signalName = list[1]
        args = json.loads(list[2])
        if (self.serviceAgents.has_key(className) == True):            
            exe_str = "self.serviceAgents['"+ className +"']."+ signalName + "("
            if len(args) > 0:
                exe_str += json.dumps(args[0])
                for idx in args[1:]:
                    exe_str += "," + json.dumps(idx)
            exe_str += ")"               
            eval(exe_str, self.globalCtx, self.localCtx)
        else:
            raise Exception("No object path " + objectPath)

    @exportRpc
    def returnMethod(self, list):
        '''
        arguments: methodId, callIndex, success (=true, error otherwise), result (to return)
        '''
        methodId = list[0]
        callIndex = list[1]
        success = list[2]
        result = list[3]
        if (self.servicePendingCalls.has_key(methodId)):
            cb = self.servicePendingCalls[methodId]['calls'][callIndex]
            if cb is None:
                raise Exception("No pending call " + str(callIndex) + " for methodID " + methodId)
            if (success):                
                successCB = cb["successCB"]
                if (result != None):
                    successCB(result)
                else:
                    successCB()                    
            else:     
                errorCB = cb["errorCB"]        
                if (result != None):
                    errorCB(result)
                else:
                    errorCB()
            self.servicePendingCalls[methodId]['calls'][callIndex] = None
            self.servicePendingCalls[methodId]['count'] = self.servicePendingCalls[methodId]['count'] - 1
            if self.servicePendingCalls[methodId]['count'] == 0:
                del self.servicePendingCalls[methodId]
        else:
            raise Exception("No methodID " + methodId)

    def srvCB(self, srvName, name, objPath, ifName, async_succes_cb, async_error_cb, *args):
        methodId = srvName + "#" + objPath + "#" + ifName + "#" + name
        cb = { 'successCB': async_succes_cb, 
               'errorCB': async_error_cb}
        if methodId not in self.servicePendingCalls:
            self.servicePendingCalls[methodId] = {'count': 0, 'calls': []}
            
        try:
            pendingCallStr = json.dumps({'callIndex': len(self.servicePendingCalls[methodId]['calls']), 'args': args})
        except Exception, e:                
            args = eval( str(args).replace("dbus.Byte", "dbus.Int16") )
            pendingCallStr = json.dumps({'callIndex': len(self.servicePendingCalls[methodId]['calls']), 'args': args})
               
        self.servicePendingCalls[methodId]['calls'].append(cb)
        self.servicePendingCalls[methodId]['count'] = self.servicePendingCalls[methodId]['count'] + 1
        factory.dispatch(methodId, pendingCallStr)
                    
    @exportRpc
    def serviceAdd(self, list):
        '''
        arguments: busName, srvName
        '''
        busName = list[0]
        self.bus =  cache.dbusConnexion( busName )
        srvName = list[1]
        if not OPENDOOR and (SERVICELIST == [] or SERVICELIST != [] and self.permissions['services'] == None):
            SERVICELIST.index(srvName)
            
        if (self.services.has_key(srvName) == False):
            self.services[srvName] = dbus.service.BusName(name = srvName, bus = self.bus)
        return srvName

    @exportRpc
    def serviceRelease(self, list):
        '''
        arguments: busName, srvName
        '''
        srvName = list[0]
        if (self.services.has_key(srvName) == True):
            self.services.pop(srvName)
            return srvName
        else:
            raise Exception(srvName + " does not exist")
                   
    @exportRpc
    def serviceAddAgent(self, list):
        '''
        arguments: objectPath, xmlTemplate
        '''
        srvName = list[0]
        agentObjectPath = list[1]
        xmlTemplate = list[2]
        className = createClassName(agentObjectPath)
        if (self.dynDBusClasses.has_key(className) == False):
            self.dynDBusClasses[className] = DynDBusClass(className, self.globalCtx, self.localCtx)
            self.dynDBusClasses[className].createDBusServiceFromXML(xmlTemplate)
            self.dynDBusClasses[className].declare()

        ## Class already exist, instanciate it if not already instanciated
        if (self.serviceAgents.has_key(className) == False):
            self.serviceAgents[className] = eval(className + "(self.bus, callback=self.srvCB, objPath='" + agentObjectPath + "', srvName='" + srvName + "')", self.globalCtx, self.localCtx)
            
        self.serviceAgents[className].add_to_connection()
        return (agentObjectPath)
                    
    @exportRpc
    def serviceDelAgent(self, list):
        '''
        arguments: objectPath, xmlTemplate
        '''
        agentObjectPath = list[0]
        className = createClassName(agentObjectPath)
        
        if (self.serviceAgents.has_key(className)):
            self.serviceAgents[className].remove_from_connection()
            self.serviceAgents.pop(className)
        else:
            raise Exception(agentObjectPath + " doesn't exist!")
        
        return (agentObjectPath)
                    
    @exportRpc
    def getVersion(self):
        '''
        return current version string
        '''
        return VERSION
