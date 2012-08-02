// WAMP session object
var mSession = null;

// HTML DOM elements
var mLog, mBus, mSender, mObject, mInterface, mSignal, mArgs, mUri;

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
    mSender = document.getElementById('sender');
    mObject = document.getElementById('object');
    mInterface = document.getElementById('interface');
    mSignal = document.getElementById('signal');
    mArgs = document.getElementById('args');
    mUri = document.getElementById('uri');
    
    // Connect to WAMP server
    ab.connect(mUri.value, onSessionConnectedCB, onSessionErrorCB);
};

function dbus_register()
{
    // RPC success callback
    function myAsyncFuncSuccessCB(res) {
        log_append("got result: " + res + "\n");
    }
     // RPC error callback
    function myAsyncFuncErrorCB(error, desc) {
        log_append("error: " + desc + "\n");
    }
    log_append("dbusRegister: "
    	+ mBus.options[mBus.selectedIndex].value + "\n\t"
    	+ mSender.value + "\n\t"
    	+ mObject.value + "\n\t"
    	+ mInterface.value + "\n\t"
    	+ mSignal.value + "\n"
    		);
    var arglist = [
               	mBus.options[mBus.selectedIndex].value,
               	mSender.value,
               	mObject.value,
               	mInterface.value,
               	mSignal.value
               	]

    // call dbusRegister with bus type, sender, object, and signal
    mSession.call("dbusRegister", arglist).then(myAsyncFuncSuccessCB, myAsyncFuncErrorCB);
};

function log_append(message) {
    mLog.innerHTML += message + '\n';
    mLog.scrollTop = mLog.scrollHeight;
};

function clear_log() {
    mLog.innerHTML = "";
    mLog.scrollTop = mLog.scrollHeight;
};