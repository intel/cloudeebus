/******************************************************************************
 * Copyright 2012 Intel Corporation.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 * http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *****************************************************************************/



/*****************************************************************************/

var dbus = require('node-dbus');
var DOMParser = require('xmldom').DOMParser;



/*****************************************************************************/

var cloudeebus = dbus;
cloudeebus.version = "0.4.0";
exports.dbus = dbus;
exports.cloudeebus = cloudeebus;

cloudeebus.log = function(msg) {
	console.log(msg);
};

cloudeebus.BusConnection = function(name) {
	this.name = name;
	if (this.name == "Session")
		this.bus = cloudeebus.DBUS_BUS_SESSION;
	else if (this.name == "System")
		this.bus = cloudeebus.DBUS_BUS_SYSTEM;
	return this;
};

cloudeebus.SessionBus = function() {
	return new cloudeebus.BusConnection("Session");
};

cloudeebus.SystemBus = function() {
	return new cloudeebus.BusConnection("System");
	return this;
};


cloudeebus.BusConnection.prototype.getObject = function(busName, objectPath, introspectCB, errorCB) {
	var proxy = new cloudeebus.ProxyObject(this, busName, objectPath);
	if (introspectCB)
		proxy._introspect(introspectCB, errorCB);
	return proxy;
};



/*****************************************************************************/

cloudeebus.Request = function(proxy, onsuccess, onerror) {
	this.proxy = proxy; 
	this.readyState = "pending";
	this.error = null;
	this.result = null;
	this.onsuccess = onsuccess;
	this.onerror = onerror;
    return this;
};

cloudeebus.Request.prototype.then = function(onsuccess, onerror) {
	this.onsuccess = onsuccess;
	this.onerror = onerror;
	return this;
};



/*****************************************************************************/

cloudeebus.ProxyObject = function(busConnection, busName, objectPath) {
	this.busConnection = busConnection; 
	this.busName = busName; 
	this.objectPath = objectPath; 
	this.interfaceProxies = {};
	this.handlers = {};
	return this;
};


cloudeebus.ProxyObject.prototype.getInterface = function(ifName) {
	return this.interfaceProxies[ifName];
};


cloudeebus.ProxyObject.prototype._introspect = function(successCB, errorCB) {
	
	var self = this; 

	function getAllPropertiesSuccessCB(props) {
		var ifProxy = self.interfaceProxies[self.propInterfaces[self.propInterfaces.length-1]];
		for (var prop in props)
			ifProxy[prop] = self[prop] = props[prop];
		getAllPropertiesNextInterfaceCB();
	}
	
	function getAllPropertiesNextInterfaceCB() {
		self.propInterfaces.pop();
		if (self.propInterfaces.length > 0) 
			self.callMethod("org.freedesktop.DBus.Properties", 
				"GetAll", 
				[self.propInterfaces[self.propInterfaces.length-1]]).then(getAllPropertiesSuccessCB, 
				errorCB ? errorCB : getAllPropertiesNextInterfaceCB);
		else {
			self.propInterfaces = null;
			if (successCB)
				successCB(self);
		}
	}
	
	function introspectSuccessCB(str) {
		var parser = new DOMParser();
		var xmlDoc = parser.parseFromString(str, "text/xml");
		var interfaces = xmlDoc.getElementsByTagName("interface");
		self.propInterfaces = [];
		var supportDBusProperties = false;
		for (var i=0; i < interfaces.length; i++) {
			var ifName = interfaces[i].attributes.getNamedItem("name").value;
			self.interfaceProxies[ifName] = new cloudeebus.ProxyObject(self.busConnection, self.busName, self.objectPath);
			if (ifName == "org.freedesktop.DBus.Properties")
				supportDBusProperties = true;
			var hasProperties = false;
			var ifChild = interfaces[i].firstChild;
			while (ifChild) {
				if (ifChild.nodeName == "method") {
					var nArgs = 0;
					var signature = "";
					var metChild = ifChild.firstChild;
					while (metChild) {
						if (metChild.nodeName == "arg" &&
							metChild.attributes.getNamedItem("direction").value == "in") {
								signature += metChild.attributes.getNamedItem("type").value;
								nArgs++;
						}
						metChild = metChild.nextSibling;
					}
					var metName = ifChild.attributes.getNamedItem("name").value;
					if (!self[metName])
						self._addMethod(ifName, metName, nArgs, signature);
					self.interfaceProxies[ifName]._addMethod(ifName, metName, nArgs, signature);
				}
				else if (ifChild.nodeName == "property") {
					if (!hasProperties)
						self.propInterfaces.push(ifName);
					hasProperties = true;
				}
				ifChild = ifChild.nextSibling;
			}
		}
		if (supportDBusProperties && self.propInterfaces.length > 0) {
			self.callMethod("org.freedesktop.DBus.Properties", 
				"GetAll", 
				[self.propInterfaces[self.propInterfaces.length-1]]).then(getAllPropertiesSuccessCB, 
				errorCB ? errorCB : getAllPropertiesNextInterfaceCB);
		}
		else {
			self.propInterfaces = null;
			if (successCB)
				successCB(self);
		}
	}

	// call Introspect on self
	self.callMethod("org.freedesktop.DBus.Introspectable", "Introspect", []).then(introspectSuccessCB, errorCB);
};


cloudeebus.ProxyObject.prototype._addMethod = function(ifName, method, nArgs, signature) {

	var self = this;
	
	self[method] = function() {
		var args = [];
		for (var i=0; i < nArgs; i++ )
			args.push(arguments[i]);
		return self.callMethod(ifName, method, args, signature);
	};	
};

cloudeebus.ProxyObject.prototype.callMethod = function(ifName, method, args, signature) {
	
	var self = this;
	var request = new cloudeebus.Request(this);
	
	function callMethodSuccessCB() {
		request.readyState = "done";
		request.result = arguments;
		if (request.onsuccess) {
			try {
				request.onsuccess.apply(request, request.result);
			}
			catch (e) {
				cloudeebus.log("Method callback exception: " + e);
				request.error = e;
				if (request.onerror)
					request.onerror.apply(request, [request.error]);
			}
		}
	}

	function callMethodErrorCB(error) {
		cloudeebus.log("Error calling method: " + method + " on object: " + self.objectPath + " : " + error.message);
		request.readyState = "done";
		request.error = error.desc;
		if (request.onerror)
			request.onerror.apply(request, [request.error]);
	}

	var dbusMsg = Object.create(cloudeebus.DBusMessage, {
		destination: {value: self.busName},
		path: {value: self.objectPath},
		iface: {value: ifName},
		member: {value: method},
		bus: {value: self.busConnection.bus},
		type: {value: cloudeebus.DBUS_MESSAGE_TYPE_METHOD_RETURN}
	});

	if (args.length) {
		args.unshift(signature);
		dbusMsg.appendArgs.apply(dbusMsg, args);
	}
	
	dbusMsg.on("methodResponse", callMethodSuccessCB);
	dbusMsg.on("error", callMethodErrorCB);

	dbusMsg.send();
	return request;
};


cloudeebus.ProxyObject.prototype.connectToSignal = function(ifName, signal, successCB, errorCB) {
	
	var self = this; 

	function signalHandler() {
		if (successCB) {
			try { // first argument is the handler, pass the rest
				var args = [];
				for (i in arguments)
					args.push(arguments[i]);
				args.shift();
				successCB.apply(self, args);
			}
			catch (e) {
				cloudeebus.log("Signal handler exception: " + e);
				if (errorCB)
					errorCB(e);
			}
		}
	}
	
	function connectToSignalErrorCB(error) {
		cloudeebus.log("Error connecting to signal: " + signal + " on object: " + self.objectPath + " : " + error.message);
		if (errorCB)
			errorCB(error.message);
	}

	var dbusSignalHandler = Object.create(cloudeebus.DBusMessage, {
		path: {value: self.objectPath},
		iface: {value: ifName},
		member: {value: signal},
		bus: {value: self.busConnection.bus},
		type: {value: cloudeebus.DBUS_MESSAGE_TYPE_SIGNAL}
	});

	this.handlers[ifName + "#" + signal] = dbusSignalHandler;
	
	dbusSignalHandler.on ("signalReceipt", signalHandler);
	dbusSignalHandler.on ("error", connectToSignalErrorCB);

	dbusSignalHandler.addMatch();
};


cloudeebus.ProxyObject.prototype.disconnectSignal = function(ifName, signal) {
	this.handlers[ifName + "#" + signal].removeMatch();
};
