// WAMP session object
var mSession = null;

// HTML DOM elements
var mLog, mBus, mDestination, mObject, mMessage, mArgs;

window.onload = function() {

    function onSessionConnectedCB(session) { // WAMP session was established
        mSession = session;
        log_append("Session successfully connected.");
    }

    function onSessionErrorCB(code, reason) { // WAMP session is gone
        mSession = null;
        if (code == ab.CONNECTION_UNSUPPORTED) {
             log_append("Browser is not supported");
        } else {
            log_append("Failed to open session, code = " + code + ", reason = " + reason);
        }
    }
    
    mLog = document.getElementById('log');
    mBus = document.getElementById('bus');
    mDestination = document.getElementById('destination');
    mObject = document.getElementById('object');
    mMessage = document.getElementById('message');
    mArgs = document.getElementById('args');
    
    // Connect to WAMP server
    ab.connect("ws://localhost:9000", onSessionConnectedCB, onSessionErrorCB);
};

function dbus_send()
{
    // RPC success callback
    function myAsyncFuncSuccessCB(res) {
        log_append("got result: " + res + "\n");
    }
     // RPC error callback
    function myAsyncFuncErrorCB(error, desc) {
        log_append("error: " + desc + "\n");
    }
    log_append("dbusSend: "
    	+ mBus.options[mBus.selectedIndex].value + "\n\t"
    	+ mDestination.value + "\n\t"
    	+ mObject.value + "\n\t"
    	+ mMessage.value + "\n\t"
    	+ mArgs.value + "\n"
    		);
    var arglist = [
               	mBus.options[mBus.selectedIndex].value,
               	mDestination.value,
               	mObject.value,
               	mMessage.value,
               	mArgs.value
                ]
    // call dbusSend with bus type, destination, object, message and arguments
    mSession.call("dbusSend", arglist).then(myAsyncFuncSuccessCB, myAsyncFuncErrorCB);
};

function log_append(message) {
    mLog.innerHTML += message + '\n';
    mLog.scrollTop = mLog.scrollHeight;
};

function clear_log() {
    mLog.innerHTML = "";
    mLog.scrollTop = mLog.scrollHeight;
};