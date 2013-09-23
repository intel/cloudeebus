/******************************************************************************
 * Copyright 2012 - 2013 Intel Corporation.
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

cloudeebus.ProxyObject = function(session, busConnection, busName, objectPath) {
	this.wampSession = session; 
	this.busConnection = busConnection; 
	this.busName = busName; 
	this.objectPath = objectPath; 
	this.interfaceProxies = {};
	this.childNodeNames = [];
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
		var nodes = xmlDoc.getElementsByTagName("node");
		// first node is the parent/head node
		for(var i=1; i < nodes.length; i++)
			self.childNodeNames.push(nodes[i].getAttribute("name"));
		var interfaces = xmlDoc.getElementsByTagName("interface");
		self.propInterfaces = [];
		var supportDBusProperties = false;
		for (var i=0; i < interfaces.length; i++) {
			var ifName = interfaces[i].attributes.getNamedItem("name").value;
			self.interfaceProxies[ifName] = new cloudeebus.ProxyObject(self.wampSession, self.busConnection, self.busName, self.objectPath);
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
	
	var promise = new cloudeebus.Promise(function (resolver) {
		function callMethodSuccessCB(str) {
			try { // calling dbus hook object function for un-translated types
				var result = eval(str);
				resolver.fulfill(result[0], true);
			}
			catch (e) {
				var errorStr = cloudeebus.getError(e);
				cloudeebus.log("Method callback exception: " + errorStr);
				resolver.reject(errorStr, true);
			}
		}

		function callMethodErrorCB(error) {
			var errorStr = cloudeebus.getError(error);
			cloudeebus.log("Error calling method: " + method + " on object: " + self.objectPath + " : " + errorStr);
			resolver.reject(errorStr, true);
		}

		var arglist = [
			self.busConnection.name,
			self.busName,
			self.objectPath,
			ifName,
			method,
			JSON.stringify(args)
		];

		// call dbusSend with bus type, destination, object, message and arguments
		self.wampSession.call("dbusSend", arglist).then(callMethodSuccessCB, callMethodErrorCB);
	});
	
	return promise;
};


cloudeebus.ProxyObject.prototype.connectToSignal = function(ifName, signal, handlerCB, errorCB) {
	
	var self = this; 

	function signalHandler(id, data) {
		if (handlerCB) {
			try { // calling dbus hook object function for un-translated types
				handlerCB.apply(self, eval(data));
			}
			catch (e) {
				var errorStr = cloudeebus.getError(e);
				cloudeebus.log("Signal handler exception: " + errorStr);
				if (errorCB)
					errorCB(errorStr);
			}
		}
	}
	
	function connectToSignalSuccessCB(str) {
		try {
			self.wampSession.subscribe(str, signalHandler);
		}
		catch (e) {
			cloudeebus.log("Subscribe error: " + cloudeebus.getError(e));
		}
	}

	function connectToSignalErrorCB(error) {
		var errorStr = cloudeebus.getError(error);
		cloudeebus.log("Error connecting to signal: " + signal + " on object: " + self.objectPath + " : " + errorStr);
		if (errorCB)
			errorCB(errorStr);
	}

	var arglist = [
		self.busConnection.name,
		self.busName,
		self.objectPath,
		ifName,
		signal
	];

	// call dbusSend with bus type, destination, object, message and arguments
	self.wampSession.call("dbusRegister", arglist).then(connectToSignalSuccessCB, connectToSignalErrorCB);
};


cloudeebus.ProxyObject.prototype.disconnectSignal = function(ifName, signal) {
	try {
		this.wampSession.unsubscribe(this.busConnection.name + "#" + this.busName + "#" + this.objectPath + "#" + ifName + "#" + signal);
	}
	catch (e) {
		cloudeebus.log("Unsubscribe error: " + cloudeebus.getError(e));
	}
};
