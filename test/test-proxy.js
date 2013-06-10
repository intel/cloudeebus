#!/usr/bin/env node

/******************************************************************************
 * Copyright 2013 Intel Corporation.
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

var cloudeebus = require('../cloudeebus/cloudeebus.js').cloudeebus;

console.log("cloudeebus.version:" + cloudeebus.version);
/*****************************************************************************/

//Wait for async reply before exiting
var pollWaitInterval;
var pending = true;

function pollWait() {
	console.log("Pending... " + pending);
	if (!pending)
		clearInterval(pollWaitInterval);
}

pollWaitInterval = setInterval(pollWait,2000);


/*****************************************************************************/

function logCB(result) {
	console.log("[LOG] " + JSON.stringify(result));
}

function errorCB(str) {
	console.log("[ERROR] " + str);
	pending = false;
}

function notifCB(result) {
	this.disconnectSignal("org.gnome.ScreenSaver", "ActiveChanged");
	console.log("[NOTIF] " + JSON.stringify(result));
	pending = false;
}

function gotNotifProxy(proxy) {
	proxy.Notify("Cloudeebus",0,"","Cloudeebus says:", "Hello, world !", [], {}, 0);
	proxy.getInterface("org.freedesktop.Notifications").GetCapabilities().then(logCB, errorCB);
}

function gotBusProxy(proxy) {
	proxy.ListNames().then(logCB, errorCB);
}

function gotScreenSaverProxy(proxy) {
	proxy.connectToSignal("org.gnome.ScreenSaver", "ActiveChanged", notifCB, errorCB);
}

cloudeebus.SessionBus().getObject("org.freedesktop.DBus", "/org/freedesktop/DBus", gotBusProxy, errorCB);
cloudeebus.SessionBus().getObject("org.freedesktop.Notifications", "/org/freedesktop/Notifications", gotNotifProxy, errorCB);

cloudeebus.SessionBus().getObject("org.gnome.ScreenSaver", "/org/gnome/ScreenSaver", gotScreenSaverProxy, errorCB);

