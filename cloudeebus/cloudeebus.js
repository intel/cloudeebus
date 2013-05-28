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

var cloudeebus = window.cloudeebus = {
		version: "0.4.0",
		minVersion: "0.3.2"
};

cloudeebus.reset = function() {
	cloudeebus.sessionBus = null;
	cloudeebus.systemBus = null;
	cloudeebus.wampSession = null;
	cloudeebus.uri = null;
};


cloudeebus.log = function(msg) { 
};


cloudeebus.versionCheck = function(version) {
	var ver = version.split(".");
	var min = cloudeebus.minVersion.split(".");
	for (var i=0; i<ver.length; i++) {
		if (Number(ver[i]) > Number(min[i]))
			return true;
		if (Number(ver[i]) < Number(min[i]))
			return false;
	}
	return true;
};


cloudeebus.connect = function(uri, manifest, successCB, errorCB) {
	cloudeebus.reset();
	cloudeebus.uri = uri;
	
	function onCloudeebusVersionCheckCB(version) {
		if (cloudeebus.versionCheck(version)) {
			cloudeebus.log("Connected to " + cloudeebus.uri);
			if (successCB)
				successCB();
		} else {
			var errorMsg = "Cloudeebus server version " + version + " unsupported, need version " + cloudeebus.minVersion + " or superior";
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
					{permissions: manifest.permissions}
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
	this.service = null;
	return this;
};


cloudeebus.BusConnection.prototype.getObject = function(busName, objectPath, introspectCB, errorCB) {
	var proxy = new cloudeebus.ProxyObject(this.wampSession, this, busName, objectPath);
	if (introspectCB)
		proxy._introspect(introspectCB, errorCB);
	return proxy;
};


cloudeebus.BusConnection.prototype.addService = function(serviceName) {
	var self = this;
	
	
	var future = new cloudeebus.Future(function (resolver) {
	  cloudeebusService = new cloudeebus.Service(self.wampSession, self, serviceName);
	
	  function busServiceAddedSuccessCB(service) {
		  self.service = cloudeebusService;
		  try {
			  var result = [cloudeebusService];
			  resolver.accept(result[0], true);
		  }
		  catch (e) {
			  cloudeebus.log("Method callback exception: " + e);
			  resolver.reject(e, true);
		  }		
	  }
	
	  function busServiceErrorSuccessCB(error) {
		  self.service = null;
		  resolver.reject(error, true);
	  }
	
	  cloudeebusService.add(this).then(busServiceAddedSuccessCB, busServiceErrorSuccessCB);
	});
	
	return future;
};

cloudeebus.BusConnection.prototype.removeService = function(serviceName, successCB, errorCB) {
	var self = this;
	
	function busServiceRemovedSuccessCB(serviceName) {
		// Be sure we are removing the service requested...
		if (serviceName == self.service.name) {
			self.service = null;
			if (successCB)
				successCB(serviceName);
		}
	}
	
	cloudeebusService.remove(busServiceRemovedSuccessCB, errorCB);
};


/*****************************************************************************/

cloudeebus.Service = function(session, busConnection, name) {
	this.wampSession = session;
	this.busConnection = busConnection; 
	this.name = name;
	this.isCreated = false;
	return this;
};

cloudeebus.Service.prototype.add = function(future) {
	var self = this;
	self.future = future;
	
	function ServiceAddedSuccessCB(serviceName) {
		try { // calling dbus hook object function for un-translated types
			var resolver = self.future.resolver;
			var result = [self];
			resolver.accept(result[0], true);
		}
		catch (e) {
			cloudeebus.log("Method callback exception: " + e);
			resolver.reject(e, true);
		}		
	}
	
	function ServiceAddedErrorCB(error) {
		cloudeebus.log("Error adding service method: " + self.name + ", error: " + error.desc);
		self.future.resolver.reject(error.desc, true);
	}

	var arglist = [
	    this.busConnection,
	    this.name
	    ];

	// call dbusSend with bus type, destination, object, message and arguments
	this.wampSession.call("serviceAdd", arglist).then(ServiceAddedSuccessCB, ServiceAddedErrorCB);
	return future;
};

cloudeebus.Service.prototype.remove = function(successCB, errorCB) {
	function ServiceRemovedSuccessCB(serviceName) {
		if (successCB) {
			try {
				successCB(serviceName);
			}
			catch (e) {
				alert("Exception removing service " + serviceName + " : " + e);
			}
		}
	}
	
	var arglist = [
	    this.name
	    ];

	// call dbusSend with bus type, destination, object, message and arguments
	this.wampSession.call("serviceRelease", arglist).then(ServiceRemovedSuccessCB, errorCB);
};

cloudeebus.Service.prototype._searchMethod = function(ifName, method, objectJS) {

	var funcToCall = null;
	
	// Check if 'objectJS' has a member 'interfaceProxies' with an interface named 'ifName' 
	// and a method named 'method'
	if (objectJS.interfaceProxies && objectJS.interfaceProxies[ifName] &&
		objectJS.interfaceProxies[ifName][method]) {
		funcToCall = objectJS.interfaceProxies[ifName][method];
	} else {
		// retrieve the method directly from 'root' of objectJs
		funcToCall = objectJS[method];
	}

	return funcToCall;
};

cloudeebus.Service.prototype._addMethod = function(objectPath, ifName, method, objectJS) {

	var service = this;
	var methodId = this.name + "#" + objectPath + "#" + ifName + "#" + method;
	var funcToCall = this._searchMethod(ifName, method, objectJS);

	if (funcToCall == null)
		cloudeebus.log("Method " + method + " doesn't exist in Javascript object");
	else {
		objectJS.wrapperFunc[method] = function() {
			var result;
			var methodId = arguments[0];
			var callDict = {};
			// affectation of callDict in eval, otherwise dictionary(='{}') interpreted as block of code by eval
			eval("callDict = " + arguments[1]);
			try {
				result = funcToCall.apply(objectJS, callDict.args);
				service._returnMethod(methodId, callDict.callIndex, true, result);
			}
			catch (e) {
				cloudeebus.log("Method " + ifName + "." + method + " call on " + objectPath + " exception: " + e);
				service._returnMethod(methodId, callDict.callIndex, false, e.message);
			}
		};
		this._registerMethod(methodId, objectJS.wrapperFunc[method]);
	}
};

cloudeebus.Service.prototype._addSignal = function(objectPath, ifName, signal, objectJS) {
	var service = this;
	var methodExist = false;

	if (objectJS.interfaceProxies && objectJS.interfaceProxies[ifName])
		if (objectJS.interfaceProxies[ifName][signal]) {
			methodExist = true;
		} else {
			objectJS.interfaceProxies[ifName][signal] = function() {
				service.emitSignal(objectPath, signal, arguments[0]);
			};
		return;
	}
		
	if ((objectJS[signal] == undefined || objectJS[signal] == null) && !methodExist) 
		objectJS[signal] = function() {
			service.emitSignal(objectPath, signal, arguments[0]);
		};
	else
		cloudeebus.log("Can not create new method to emit signal '" + signal + "' in object JS this method already exist!");
};

cloudeebus.Service.prototype._createWrapper = function(xmlTemplate, objectPath, objectJS) {
	var self = this;
	var parser = new DOMParser();
	var xmlDoc = parser.parseFromString(xmlTemplate, "text/xml");
	var ifXml = xmlDoc.getElementsByTagName("interface");
	objectJS.wrapperFunc = [];
	for (var i=0; i < ifXml.length; i++) {
		var ifName = ifXml[i].attributes.getNamedItem("name").value;
		var ifChild = ifXml[i].firstChild;
		while (ifChild) {
			if (ifChild.nodeName == "method") {
				var metName = ifChild.attributes.getNamedItem("name").value;
				self._addMethod(objectPath, ifName, metName, objectJS);
			}
			if (ifChild.nodeName == "signal") {
				var metName = ifChild.attributes.getNamedItem("name").value;
				self._addSignal(objectPath, ifName, metName, objectJS);
			}
			ifChild = ifChild.nextSibling;
		}
	}
};

cloudeebus.Service.prototype.addAgent = function(objectPath, xmlTemplate, objectJS, successCB, errorCB) {
	function ServiceAddAgentSuccessCB(objPath) {
		if (successCB) {
			try {
				successCB(objPath);
			}
			catch (e) {
				alert("Exception adding agent " + objectPath + " : " + e);
			}
		}
	}
	
	try {
		this._createWrapper(xmlTemplate, objectPath, objectJS);
	}
	catch (e) {
		alert("Exception creating agent wrapper " + objectPath + " : " + e);
		errorCB(e.desc);
		return;
	}
	
	var arglist = [
	    objectPath,
	    xmlTemplate
	    ];

	// call dbusSend with bus type, destination, object, message and arguments
	this.wampSession.call("serviceAddAgent", arglist).then(ServiceAddAgentSuccessCB, errorCB);
};

cloudeebus.Service.prototype.delAgent = function(objectPath, successCB, errorCB) {
	function ServiceDelAgentSuccessCB(agent) {
		if (successCB) {
			try {
				successCB(agent);
			}
			catch (e) {
				alert("Exception deleting agent " + objectPath + " : " + e);
			}
		}
	}
	
	var arglist = [
	    objectPath
	    ];

	// call dbusSend with bus type, destination, object, message and arguments
	this.wampSession.call("serviceDelAgent", arglist).then(ServiceDelAgentSuccessCB, errorCB);
};

cloudeebus.Service.prototype._registerMethod = function(methodId, methodHandler) {
	this.wampSession.subscribe(methodId, methodHandler);
};

cloudeebus.Service.prototype._returnMethod = function(methodId, callIndex, success, result, successCB, errorCB) {
	var arglist = [
	    methodId,
	    callIndex,
	    success,
	    result
	    ];

	this.wampSession.call("returnMethod", arglist).then(successCB, errorCB);
};

cloudeebus.Service.prototype.emitSignal = function(objectPath, signalName, result, successCB, errorCB) {
	var arglist = [
	    objectPath,
	    signalName,
	    result
	    ];

	this.wampSession.call("emitSignal", arglist).then(successCB, errorCB);
};


/*****************************************************************************/

function _processWrappers(wrappers, value) {
	for (var i=0; i<wrappers.length; i++)
		wrappers[i](value);
}


function _processWrappersAsync(wrappers, value) {
	var taskid = -1;
	function processAsyncOnce() {
		_processWrappers(wrappers, value);
		clearInterval(taskid);
	}
	taskid = setInterval(processAsyncOnce, 200);
}



/*****************************************************************************/

cloudeebus.FutureResolver = function(future) {
	this.future = future;
	this.resolved = null;
    return this;
};


cloudeebus.FutureResolver.prototype.resolve = function(value, sync) {
	if (this.resolved)
		return;
	
	var then = (value && value.then && value.then.apply) ? value.then : null;
	if (then) {
		var self = this;		
		var acceptCallback = function(arg) {
			self.resolve(arg, true);
		};	
		var rejectCallback = function(arg) {
			self.reject(arg, true);
		};
		try {
			then.apply(value, [acceptCallback, rejectCallback]);
		}
		catch (e) {
			this.reject(e, true);
		}
	}
	
	this.accept(value, sync);
};


cloudeebus.FutureResolver.prototype.accept = function(value, sync) {
	if (this.resolved)
		return;
	
	var future = this.future;
	future.state = "accepted";
	future.result = value;
	
	this.resolved = true;
	if (sync)
		_processWrappers(future._acceptWrappers, value);
	else
		_processWrappersAsync(future._acceptWrappers, value);
};


cloudeebus.FutureResolver.prototype.reject = function(value, sync) {
	if (this.resolved)
		return;
	
	var future = this.future;
	future.state = "rejected";
	future.result = value;
	
	this.resolved = true;
	if (sync)
		_processWrappers(future._rejectWrappers, value);
	else
		_processWrappersAsync(future._rejectWrappers, value);
};



/*****************************************************************************/

cloudeebus.Future = function(init) {
	this.state = "pending";
	this.result = null;
	this._acceptWrappers = [];
	this._rejectWrappers = [];
	this.resolver = new cloudeebus.FutureResolver(this);
	if (init) {
		try {
			init.apply(this, [this.resolver]);
		}
		catch (e) {
			this.resolver.reject(e, true);
		}
	}
    return this;
};


cloudeebus.Future.prototype.appendWrappers = function(acceptWrapper, rejectWrapper) {
	this._acceptWrappers.push(acceptWrapper);
	this._rejectWrappers.push(rejectWrapper);
	if (this.state == "accepted")
		_processWrappersAsync(this._acceptWrappers, this.result);
	if (this.state == "rejected")
		_processWrappersAsync(this._rejectWrappers, this.result);
};


cloudeebus.Future.prototype.then = function(acceptCB, rejectCB) {
	var future = new cloudeebus.Future();
	var resolver = future.resolver;
	var acceptWrapper, rejectWrapper;
	
	if (acceptCB)
		acceptWrapper = function(arg) {
			try {
				var value = acceptCB.apply(future, [arg]);
				resolver.resolve(value, true);
			}
			catch (e) {
				resolver.reject(e, true);
			}
		};
	else
		acceptWrapper = function(arg) {
			resolver.accept(arg, true);
		};
	
	if (rejectCB)
		rejectWrapper = function(arg) {
			try {
				var value = rejectCB.apply(future, [arg]);
				resolver.resolve(value, true);
			}
			catch (e) {
				resolver.reject(e, true);
			}
		};
	else
		rejectWrapper = function(arg) {
			resolver.reject(arg, true);
		};
	
	this.appendWrappers(acceptWrapper,rejectWrapper);
	return future;
};



/*****************************************************************************/

function _processWrappers(wrappers, value) {
	for (var i=0; i<wrappers.length; i++)
		wrappers[i](value);
}


function _processWrappersAsync(wrappers, value) {
	var taskid = -1;
	function processAsyncOnce() {
		_processWrappers(wrappers, value);
		clearInterval(taskid);
	}
	taskid = setInterval(processAsyncOnce, 200);
}



/*****************************************************************************/

cloudeebus.FutureResolver = function(future) {
	this.future = future;
	this.resolved = null;
    return this;
};


cloudeebus.FutureResolver.prototype.resolve = function(value, sync) {
	if (this.resolved)
		return;
	
	var then = (value && value.then && value.then.apply) ? value.then : null;
	if (then) {
		var self = this;		
		var acceptCallback = function(arg) {
			self.resolve(arg, true);
		};	
		var rejectCallback = function(arg) {
			self.reject(arg, true);
		};
		try {
			then.apply(value, [acceptCallback, rejectCallback]);
		}
		catch (e) {
			this.reject(e, true);
		}
	}
	
	this.accept(value, sync);
};


cloudeebus.FutureResolver.prototype.accept = function(value, sync) {
	if (this.resolved)
		return;
	
	var future = this.future;
	future.state = "accepted";
	future.result = value;
	
	this.resolved = true;
	if (sync)
		_processWrappers(future._acceptWrappers, value);
	else
		_processWrappersAsync(future._acceptWrappers, value);
};


cloudeebus.FutureResolver.prototype.reject = function(value, sync) {
	if (this.resolved)
		return;
	
	var future = this.future;
	future.state = "rejected";
	future.result = value;
	
	this.resolved = true;
	if (sync)
		_processWrappers(future._rejectWrappers, value);
	else
		_processWrappersAsync(future._rejectWrappers, value);
};



/*****************************************************************************/

cloudeebus.Future = function(init) {
	this.state = "pending";
	this.result = null;
	this._acceptWrappers = [];
	this._rejectWrappers = [];
	this.resolver = new cloudeebus.FutureResolver(this);
	if (init) {
		try {
			init.apply(this, [this.resolver]);
		}
		catch (e) {
			this.resolver.reject(e, true);
		}
	}
    return this;
};


cloudeebus.Future.prototype.appendWrappers = function(acceptWrapper, rejectWrapper) {
	if (acceptWrapper)
		this._acceptWrappers.push(acceptWrapper);
	if (rejectWrapper)
		this._rejectWrappers.push(rejectWrapper);
	if (this.state == "accepted")
		_processWrappersAsync(this._acceptWrappers, this.result);
	if (this.state == "rejected")
		_processWrappersAsync(this._rejectWrappers, this.result);
};


cloudeebus.Future.prototype.then = function(acceptCB, rejectCB) {
	var future = new cloudeebus.Future();
	var resolver = future.resolver;
	var acceptWrapper, rejectWrapper;
	
	if (acceptCB)
		acceptWrapper = function(arg) {
			try {
				var value = acceptCB.apply(future, [arg]);
				resolver.resolve(value, true);
			}
			catch (e) {
				resolver.reject(e, true);
			}
		};
	else
		acceptWrapper = function(arg) {
			resolver.accept(arg, true);
		};
	
	if (rejectCB)
		rejectWrapper = function(arg) {
			try {
				var value = rejectCB.apply(future, [arg]);
				resolver.resolve(value, true);
			}
			catch (e) {
				resolver.reject(e, true);
			}
		};
	else
		rejectWrapper = function(arg) {
			resolver.reject(arg, true);
		};
	
	this.appendWrappers(acceptWrapper,rejectWrapper);
	return future;
};


cloudeebus.Future.prototype["catch"] = function(rejectCB) {
	return this.then(undefined,rejectCB);
};


cloudeebus.Future.prototype.done = function(acceptCB, rejectCB) {
	this.appendWrappers(acceptCB,rejectCB);
};


cloudeebus.Future.resolve = function(value) {
	var future = new cloudeebus.Future();
	future.resolver.resolve(value);
	return future;
};


cloudeebus.Future.accept = function(value) {
	var future = new cloudeebus.Future();
	future.resolver.accept(value);
	return future;
};


cloudeebus.Future.reject = function(value) {
	var future = new cloudeebus.Future();
	future.resolver.reject(value);
	return future;
};


cloudeebus.Future.any = function() {
	var future = new cloudeebus.Future();
	var resolver = future.resolver;
	var acceptCallback = function(arg) {
		resolver.resolve(arg, true);
	};
	var rejectCallback = function(arg) {
		resolver.reject(arg, true);
	};
	if (arguments.length == 0)
		resolver.resolve(undefined, true);
	else
		for (i in arguments) 
			Future.resolve(arguments[i]).appendWrappers(acceptCallback,rejectCallback);
	return future;
};


cloudeebus.Future.every = function() {
	var future = new cloudeebus.Future();
	var resolver = future.resolver;
	var index = 0;
	var countdown = arguments.length;
	var args = new Array(countdown);
	var rejectCallback = function(arg) {
		resolver.reject(arg, true);
	};
	if (arguments.length == 0)
		resolver.resolve(undefined, true);
	else
		for (i in arguments) {
			var acceptCallback = function(arg) {
				args[index] = arg;
				countdown--;
				if (countdown == 0)
					resolver.resolve(args, true);
			};
			index++;
			Future.resolve(arguments[i]).appendWrappers(acceptCallback,rejectCallback);
		}
	
	return future;
};


cloudeebus.Future.some = function() {
	var future = new cloudeebus.Future();
	var resolver = future.resolver;
	var index = 0;
	var countdown = arguments.length;
	var args = new Array(countdown);
	var acceptCallback = function(arg) {
		resolver.resolve(arg, true);
	};
	if (arguments.length == 0)
		resolver.resolve(undefined, true);
	else
		for (i in arguments) {
			var rejectCallback = function(arg) {
				args[index] = arg;
				countdown--;
				if (countdown == 0)
					resolver.reject(args, true);
			};
			index++;
			Future.resolve(arguments[i]).appendWrappers(acceptCallback,rejectCallback);
		}
	
	return future;
};



/*****************************************************************************/

cloudeebus.ProxyObject = function(session, busConnection, busName, objectPath) {
	this.wampSession = session; 
	this.busConnection = busConnection; 
	this.busName = busName; 
	this.objectPath = objectPath; 
	this.interfaceProxies = {};
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
	
	var future = new cloudeebus.Future(function (resolver) {
		function callMethodSuccessCB(str) {
			try { // calling dbus hook object function for un-translated types
				var result = eval(str);
				resolver.accept(result[0], true);
			}
			catch (e) {
				cloudeebus.log("Method callback exception: " + e);
				resolver.reject(e, true);
			}
		}

		function callMethodErrorCB(error) {
			cloudeebus.log("Error calling method: " + method + " on object: " + self.objectPath + " : " + error.desc);
			resolver.reject(error.desc, true);
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
	
	return future;
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
