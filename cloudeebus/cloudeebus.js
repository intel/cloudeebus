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
		version: "0.6.0",
		minVersion: "0.6.0"
};

cloudeebus.reset = function() {
	cloudeebus.sessionBus = null;
	cloudeebus.systemBus = null;
	cloudeebus.wampSession = null;
	cloudeebus.uri = null;
};


cloudeebus.log = function(msg) { 
};

cloudeebus.getError = function(error) {
	if (error.desc && error.uri)
		return error.desc + " : " + error.uri; // Python exception (cloudeebus.py)
	if (error.desc)
		return error.desc;
	if (error.uri)
		return error.uri;
	if (error.name && error.message)
		return error.name + " : " + error.message; // Javascript exception
	if (error.message)
		return error.message;
	if (error.name)
		return error.name;
	return error; // Autobahn error
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
		var errorStr = cloudeebus.getError(error);
		cloudeebus.log("Authentication error: " + errorStr);
		if (errorCB)
			errorCB(errorStr);
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
					{permissions: manifest.permissions, 
						 services: manifest.services}
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


cloudeebus.BusConnection.prototype.addService = function(serviceName) {
	var self = this;

	var promise = new cloudeebus.Promise(function (resolver) {
		var cloudeebusService = new cloudeebus.Service(self.wampSession, self, serviceName);
	
		function ServiceAddedSuccessCB(serviceName) {
			cloudeebusService.isCreated = true;
			resolver.fulfill(cloudeebusService, true);
		}
		
		function ServiceAddedErrorCB(error) {
			var errorStr = cloudeebus.getError(error);
			cloudeebus.log("Error adding service method: " + self.name + ", error: " + errorStr);
			resolver.reject(errorStr, true);
		}

		var arglist = [
		    self.name,
		    serviceName
		    ];

		// call dbusSend with bus type, destination, object, message and arguments
		self.wampSession.call("serviceAdd", arglist).then(ServiceAddedSuccessCB, ServiceAddedErrorCB);
	});
	
	return promise;
};



/*****************************************************************************/

cloudeebus.Agent = function(objectPath, handler, xml) {
	this.xml = xml;
	this.objectPath = objectPath;
	this.handler = handler;
	return this;
};


cloudeebus.Service = function(session, busConnection, name) {
	this.wampSession = session;
	this.busConnection = busConnection; 
	this.name = name;
	this.agents = [];
	this.isCreated = false;
	return this;
};


cloudeebus.Service.prototype.remove = function() {
	var self = this;
	
	var promise = new cloudeebus.Promise(function (resolver) {
		function ServiceRemovedSuccessCB(serviceName) {
			resolver.fulfill(serviceName, true);
		}
		
		function ServiceRemovedErrorCB(error) {
			var errorStr = cloudeebus.getError(error);
			resolver.reject(errorStr, true);
		}
		
		var arglist = [
		    self.name
		    ];
	
		// call dbusSend with bus type, destination, object, message and arguments
		self.wampSession.call("serviceRelease", arglist).then(ServiceRemovedSuccessCB, ServiceRemovedErrorCB);
	});
	
	return promise;
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


cloudeebus.Service.prototype._addMethod = function(ifName, method, agent) {

	var service = this;
	var methodId = this.name + "#" + agent.objectPath + "#" + ifName + "#" + method;
	var funcToCall = this._searchMethod(ifName, method, agent.handler);

	if (funcToCall == null)
		cloudeebus.log("Method " + method + " doesn't exist in Javascript object");
	else {
		agent.handler.wrapperFunc[method] = function() {
			var result;
			var methodId = arguments[0];
			var callDict = {};
			// affectation of callDict in eval, otherwise dictionary(='{}') interpreted as block of code by eval
			eval("callDict = " + arguments[1]);
			try {
				result = funcToCall.apply(agent.handler, callDict.args);
				service._returnMethod(methodId, callDict.callIndex, true, result);
			}
			catch (e) {
				var errorStr = cloudeebus.getError(e);
				cloudeebus.log("Method " + ifName + "." + method + " call on " + agent.objectPath + " exception: " + errorStr);
				service._returnMethod(methodId, callDict.callIndex, false, errorStr);
			}
		};
		agent.handler.methodId[agent.objectPath].push(methodId);
		this.wampSession.subscribe(methodId, agent.handler.wrapperFunc[method]);
	}
};


cloudeebus.Service.prototype._addSignal = function(ifName, signal, agent) {
	var service = this;

	if (agent.handler[signal])
		cloudeebus.log("Signal '" + signal + "' emitter already implemented");
	else {
		agent.handler[signal] = function() {
			var args = [];
			for (var i=0; i < arguments.length; i++ )
				args.push(arguments[i]);
			service._emitSignal(agent.objectPath, signal, args);
		};
	}
};


cloudeebus.Service.prototype._createWrapper = function(agent) {
	var self = this;
	var parser = new DOMParser();
	var xmlDoc = parser.parseFromString(agent.xml, "text/xml");
	var ifXml = xmlDoc.getElementsByTagName("interface");
	agent.handler.wrapperFunc = {};
	agent.handler.methodId = {};
	agent.handler.methodId[agent.objectPath] = [];
	for (var i=0; i < ifXml.length; i++) {
		var ifName = ifXml[i].attributes.getNamedItem("name").value;
		var ifChild = ifXml[i].firstChild;
		while (ifChild) {
			if (ifChild.nodeName == "method") {
				var metName = ifChild.attributes.getNamedItem("name").value;
				self._addMethod(ifName, metName, agent);
			}
			if (ifChild.nodeName == "signal") {
				var metName = ifChild.attributes.getNamedItem("name").value;
				self._addSignal(ifName, metName, agent);
			}
			ifChild = ifChild.nextSibling;
		}
	}
};


cloudeebus.Service.prototype.addAgent = function(agent) {
	var self = this;
	
	var promise = new cloudeebus.Promise(function (resolver) {
		function ServiceAddAgentSuccessCB(objPath) {
			self.agents.push(agent);
			try {
				self._createWrapper(agent);
			}
			catch (e) {
				var errorStr = cloudeebus.getError(e);
				cloudeebus.log("Exception creating agent wrapper " + agent.objectPath + " : " + errorStr);
				resolver.reject(errorStr, true);
				return;
			}		
			resolver.fulfill(objPath, true);
		}
		
		function ServiceAddAgenterrorCB(error) {
			var errorStr = cloudeebus.getError(error);
			cloudeebus.log("Error adding agent : " + agent.objectPath + ", error: " + errorStr);
			resolver.reject(errorStr, true);
		}
		
		var arglist = [
		    self.name,
		    agent.objectPath,
		    agent.xml
		    ];
	
		// call dbusSend with bus type, destination, object, message and arguments
		self.wampSession.call("serviceAddAgent", arglist).then(ServiceAddAgentSuccessCB, ServiceAddAgenterrorCB);
	});
	
	return promise;
};


cloudeebus.Service.prototype._deleteWrapper = function(agent) {
	var objJs = agent.handler;
	if (objJs.methodId[agent.objectPath]) {
		while (objJs.methodId[agent.objectPath].length) {
			try {
				this.wampSession.unsubscribe( objJs.methodId[agent.objectPath].pop() );
			}
			catch (e) {
				cloudeebus.log("Unsubscribe error: " + cloudeebus.getError(e));
			}
		}
		objJs.methodId[agent.objectPath] = null;
	}
};


cloudeebus.Service.prototype.removeAgent = function(rmAgent) {
	var self = this;
	
	var promise = new cloudeebus.Promise(function (resolver) {
		function ServiceRemoveAgentSuccessCB(objectPath) {
			// Searching agent in list
			for (var idx in self.agents)
				if (self.agents[idx].objectPath == objectPath) {
					agent = self.agents[idx];
					break;
				}
					
			self.agents.splice(idx, 1);
			self._deleteWrapper(agent);
			resolver.fulfill(agent, true);
		}

		function ServiceRemoveAgentErrorCB(error) {
			var errorStr = cloudeebus.getError(error);
			cloudeebus.log("Error removing agent : " + rmAgent.objectPath + ", error: " + errorStr);
			resolver.reject(errorStr, true);
		}

		var arglist = [
		    rmAgent.objectPath
		    ];
	
		// call dbusSend with bus type, destination, object, message and arguments
		self.wampSession.call("serviceDelAgent", arglist).then(ServiceRemoveAgentSuccessCB, ServiceRemoveAgentErrorCB);
	});
	
	return promise;
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


cloudeebus.Service.prototype._emitSignal = function(objectPath, signalName, args, successCB, errorCB) {
	var arglist = [
	    objectPath,
	    signalName,
	    JSON.stringify(args)
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

cloudeebus.PromiseResolver = function(promise) {
	this.promise = promise;
	this.resolved = null;
    return this;
};


cloudeebus.PromiseResolver.prototype.resolve = function(value, sync) {
	if (this.resolved)
		return;
	
	var then = (value && value.then && value.then.apply) ? value.then : null;
	if (then) {
		var self = this;		
		var fulfillCallback = function(arg) {
			self.resolve(arg, true);
		};	
		var rejectCallback = function(arg) {
			self.reject(arg, true);
		};
		try {
			then.apply(value, [fulfillCallback, rejectCallback]);
		}
		catch (e) {
			this.reject(cloudeebus.getError(e), true);
		}
	}
	
	this.fulfill(value, sync);
};


cloudeebus.PromiseResolver.prototype.fulfill = function(value, sync) {
	if (this.resolved)
		return;
	
	var promise = this.promise;
	promise.state = "fulfilled";
	promise.result = value;
	
	this.resolved = true;
	if (sync)
		_processWrappers(promise._fulfillWrappers, value);
	else
		_processWrappersAsync(promise._fulfillWrappers, value);
};


cloudeebus.PromiseResolver.prototype.reject = function(value, sync) {
	if (this.resolved)
		return;
	
	var promise = this.promise;
	promise.state = "rejected";
	promise.result = value;
	
	this.resolved = true;
	if (sync)
		_processWrappers(promise._rejectWrappers, value);
	else
		_processWrappersAsync(promise._rejectWrappers, value);
};



/*****************************************************************************/

cloudeebus.Promise = function(init) {
	this.state = "pending";
	this.result = null;
	this._fulfillWrappers = [];
	this._rejectWrappers = [];
	this.resolver = new cloudeebus.PromiseResolver(this);
	if (init) {
		try {
			init.apply(this, [this.resolver]);
		}
		catch (e) {
			this.resolver.reject(cloudeebus.getError(e), true);
		}
	}
    return this;
};


cloudeebus.Promise.prototype.appendWrappers = function(fulfillWrapper, rejectWrapper) {
	if (fulfillWrapper)
		this._fulfillWrappers.push(fulfillWrapper);
	if (rejectWrapper)
		this._rejectWrappers.push(rejectWrapper);
	if (this.state == "fulfilled")
		_processWrappersAsync(this._fulfillWrappers, this.result);
	if (this.state == "rejected")
		_processWrappersAsync(this._rejectWrappers, this.result);
};


cloudeebus.Promise.prototype.then = function(fulfillCB, rejectCB) {
	var promise = new cloudeebus.Promise();
	var resolver = promise.resolver;
	var fulfillWrapper, rejectWrapper;
	
	if (fulfillCB)
		fulfillWrapper = function(arg) {
			try {
				var value = fulfillCB.apply(promise, [arg]);
				resolver.resolve(value, true);
			}
			catch (e) {
				resolver.reject(cloudeebus.getError(e), true);
			}
		};
	else
		fulfillWrapper = function(arg) {
			resolver.fulfill(arg, true);
		};
	
	if (rejectCB)
		rejectWrapper = function(arg) {
			try {
				var value = rejectCB.apply(promise, [arg]);
				resolver.resolve(value, true);
			}
			catch (e) {
				resolver.reject(cloudeebus.getError(e), true);
			}
		};
	else
		rejectWrapper = function(arg) {
			resolver.reject(arg, true);
		};
	
	this.appendWrappers(fulfillWrapper,rejectWrapper);
	return promise;
};


cloudeebus.Promise.prototype["catch"] = function(rejectCB) {
	return this.then(undefined,rejectCB);
};


cloudeebus.Promise.prototype.done = function(fulfillCB, rejectCB) {
	this.appendWrappers(fulfillCB,rejectCB);
};


cloudeebus.Promise.resolve = function(value) {
	var promise = new cloudeebus.Promise();
	promise.resolver.resolve(value);
	return promise;
};


cloudeebus.Promise.fulfill = function(value) {
	var promise = new cloudeebus.Promise();
	promise.resolver.fulfill(value);
	return promise;
};


cloudeebus.Promise.reject = function(value) {
	var promise = new cloudeebus.Promise();
	promise.resolver.reject(value);
	return promise;
};


cloudeebus.Promise.any = function() {
	var promise = new cloudeebus.Promise();
	var resolver = promise.resolver;
	var fulfillCallback = function(arg) {
		resolver.resolve(arg, true);
	};
	var rejectCallback = function(arg) {
		resolver.reject(arg, true);
	};
	if (arguments.length == 0)
		resolver.resolve(undefined, true);
	else
		for (i in arguments) 
			cloudeebus.Promise.resolve(arguments[i]).appendWrappers(fulfillCallback,rejectCallback);
	return promise;
};


cloudeebus.Promise.every = function() {
	var promise = new cloudeebus.Promise();
	var resolver = promise.resolver;
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
			var fulfillCallback = function(arg) {
				args[index] = arg;
				countdown--;
				if (countdown == 0)
					resolver.resolve(args, true);
			};
			index++;
			cloudeebus.Promise.resolve(arguments[i]).appendWrappers(fulfillCallback,rejectCallback);
		}
	
	return promise;
};


cloudeebus.Promise.some = function() {
	var promise = new cloudeebus.Promise();
	var resolver = promise.resolver;
	var index = 0;
	var countdown = arguments.length;
	var args = new Array(countdown);
	var fulfillCallback = function(arg) {
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
			cloudeebus.Promise.resolve(arguments[i]).appendWrappers(fulfillCallback,rejectCallback);
		}
	
	return promise;
};



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
