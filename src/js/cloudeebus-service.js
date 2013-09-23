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



