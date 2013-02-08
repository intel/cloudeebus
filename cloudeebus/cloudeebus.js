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

var dbus = { // hook object for dbus types not translated by python-json
		Double: function(value, level) {
			return value;
		}
};



/*****************************************************************************/

var cloudeebus = window.cloudeebus = {version: "0.2.1"};

cloudeebus.reset = function() {
	cloudeebus.sessionBus = null;
	cloudeebus.systemBus = null;
	cloudeebus.wampSession = null;
	cloudeebus.uri = null;
};


cloudeebus.log = function(msg) { 
};


cloudeebus.connect = function(uri, manifest, successCB, errorCB) {
	cloudeebus.reset();
	cloudeebus.uri = uri;
	
	function onCloudeebusVersionCheckCB(version) {
		if (cloudeebus.version == version) {
			cloudeebus.log("Connected to " + cloudeebus.uri);
			if (successCB)
				successCB();
		} else {
			var errorMsg = "Cloudeebus server version " + version + " and client version " + cloudeebus.version + " mismatch";
			cloudeebus.log(errorMsg);
			if (errorCB)
				errorCB(errorMsg);
		}
	}
	
	function onWAMPSessionAuthErrorCB(error) {
		cloudeebus.log("Authentication error: " + error.desc);
		if (errorCB)
			errorCB(error.desc);
	}
	
	function onWAMPSessionAuthenticatedCB(permissions) {
		cloudeebus.sessionBus = new cloudeebus.BusConnection("session", cloudeebus.wampSession);
		cloudeebus.systemBus = new cloudeebus.BusConnection("system", cloudeebus.wampSession);
		cloudeebus.wampSession.call("getVersion").then(onCloudeebusVersionCheckCB, errorCB);
	}
	
	function onWAMPSessionChallengedCB(challenge) {
		var signature = cloudeebus.wampSession.authsign(challenge, manifest.key);
		cloudeebus.wampSession.auth(signature).then(onWAMPSessionAuthenticatedCB, onWAMPSessionAuthErrorCB);
	}
	
	function onWAMPSessionConnectedCB(session) {
		cloudeebus.wampSession = session;
		if (manifest)
			cloudeebus.wampSession.authreq(
					manifest.name, 
					{permissions: JSON.stringify(manifest.permissions)}
				).then(onWAMPSessionChallengedCB, onWAMPSessionAuthErrorCB);
		else
			cloudeebus.wampSession.authreq().then(function() {
				cloudeebus.wampSession.auth().then(onWAMPSessionAuthenticatedCB, onWAMPSessionAuthErrorCB);
				}, onWAMPSessionAuthErrorCB);
	}

	function onWAMPSessionErrorCB(code, reason) {
		if (code == ab.CONNECTION_UNSUPPORTED) {
			cloudeebus.log("Browser is not supported");
		}
		else {
			cloudeebus.log("Failed to open session, code = " + code + ", reason = " + reason);
		}
		if (errorCB)
			errorCB(reason);
	}

	return ab.connect(cloudeebus.uri, onWAMPSessionConnectedCB, onWAMPSessionErrorCB);
};


cloudeebus.SessionBus = function() {
	return cloudeebus.sessionBus;
};


cloudeebus.SystemBus = function() {
	return cloudeebus.systemBus;
};



/*****************************************************************************/

cloudeebus.BusConnection = function(name, session) {
	this.name = name;
	this.wampSession = session;
	return this;
};


cloudeebus.BusConnection.prototype.getObject = function(busName, objectPath, introspectCB, errorCB) {
	var proxy = new cloudeebus.ProxyObject(this.wampSession, this, busName, objectPath);
	if (introspectCB)
		proxy._introspect(introspectCB, errorCB);
	return proxy;
};



/*****************************************************************************/

cloudeebus.ProxyObject = function(session, busConnection, busName, objectPath) {
	this.wampSession = session; 
	this.busConnection = busConnection; 
	this.busName = busName; 
	this.objectPath = objectPath; 
	return this;
};


cloudeebus.ProxyObject.prototype._introspect = function(successCB, errorCB) {
	
	var self = this; 

	function getAllPropertiesSuccessCB(props) {
		for (var prop in props)
			self[prop] = props[prop];
		getAllPropertiesNextInterfaceCB();
	}
	
	function getAllPropertiesNextInterfaceCB() {
		if (self.propInterfaces.length > 0) 
			self.callMethod("org.freedesktop.DBus.Properties", 
				"GetAll", 
				[self.propInterfaces.pop()], 
				getAllPropertiesSuccessCB, 
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
			if (ifName == "org.freedesktop.DBus.Properties")
				supportDBusProperties = true;
			var hasProperties = false;
			var ifChild = interfaces[i].firstChild;
			while (ifChild) {
				if (ifChild.nodeName == "method") {
					var nArgs = 0;
					var metChild = ifChild.firstChild;
					while (metChild) {
						if (metChild.nodeName == "arg" &&
							metChild.attributes.getNamedItem("direction").value == "in")
								nArgs++;
						metChild = metChild.nextSibling;
					}
					self._addMethod(ifName, 
							ifChild.attributes.getNamedItem("name").value, 
							nArgs);
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
				[self.propInterfaces.pop()], 
				getAllPropertiesSuccessCB, 
				errorCB ? errorCB : getAllPropertiesNextInterfaceCB);
		}
		else {
			self.propInterfaces = null;
			if (successCB)
				successCB(self);
		}
	}

	// call Introspect on self
	self.callMethod("org.freedesktop.DBus.Introspectable", "Introspect", [], introspectSuccessCB, errorCB);
};


cloudeebus.ProxyObject.prototype._addMethod = function(ifName, method, nArgs) {

	var self = this;
	
	self[method] = function() {
		if (arguments.length < nArgs || arguments.length > nArgs + 2)
			throw "Error: method " + method + " takes " + nArgs + " parameters, got " + arguments.length + ".";
		var args = [];
		var successCB = null;
		var errorCB = null;
		for (var i=0; i < nArgs; i++ )
			args.push(arguments[i]);
		if (arguments.length > nArgs)
			successCB = arguments[nArgs];
		if (arguments.length > nArgs + 1)
			errorCB = arguments[nArgs + 1];
		self.callMethod(ifName, method, args, successCB, errorCB);
	};
	
};


cloudeebus.ProxyObject.prototype.callMethod = function(ifName, method, args, successCB, errorCB) {
	
	var self = this; 

	function callMethodSuccessCB(str) {
		if (successCB) {
			try { // calling dbus hook object function for un-translated types
				successCB.apply(self, eval(str));
			}
			catch (e) {
				cloudeebus.log("Method callback exception: " + e);
				if (errorCB)
					errorCB(e);
			}
		}
	}

	function callMethodErrorCB(error) {
		cloudeebus.log("Error calling method: " + method + " on object: " + self.objectPath + " : " + error.desc);
		if (errorCB)
			errorCB(error.desc);
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
};


cloudeebus.ProxyObject.prototype.connectToSignal = function(ifName, signal, successCB, errorCB) {
	
	var self = this; 

	function signalHandler(id, data) {
		if (successCB) {
			try { // calling dbus hook object function for un-translated types
				successCB.apply(self, eval(data));
			}
			catch (e) {
				cloudeebus.log("Signal handler exception: " + e);
				if (errorCB)
					errorCB(e);
			}
		}
	}
	
	function connectToSignalSuccessCB(str) {
		try {
			self.wampSession.subscribe(str, signalHandler);
		}
		catch (e) {
			cloudeebus.log("Subscribe error: " + e);
		}
	}

	function connectToSignalErrorCB(error) {
		cloudeebus.log("Error connecting to signal: " + signal + " on object: " + self.objectPath + " : " + error.desc);
		if (errorCB)
			errorCB(error.desc);
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
		cloudeebus.log("Unsubscribe error: " + e);
	}
};
