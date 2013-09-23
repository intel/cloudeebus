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



