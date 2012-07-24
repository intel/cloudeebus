// WAMP session object
var mSession = null;
var mLog = null;

window.onload = function() {

    function onSessionConnectedCB(session) { // WAMP session was established
        mSession = session;
        log_append("Session successfully connected.");
        // establish a prefix, so we can abbreviate procedure URIs ..
        mSession.prefix("MyDbus", "http://cloudybus.com/MyDbus#");
 
        mSession.subscribe("MyDbus:signal1", onMySignalCB);
        mSession.subscribe("MyDbus:signal2", onMySignalCB);
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
    
    // Connect to WAMP server
    ab.connect("ws://localhost:9000", onSessionConnectedCB, onSessionErrorCB);
};

function onMySignalCB(topicUri, event) {
    log_append("-------");
    log_append(topicUri);
    log_append(event);
    log_append("-------");
};
         
function test()
{
    // RPC success callback
    function myAsyncFuncSuccessCB(res) {
        log_append("got result: " + res);
    }
     // RPC error callback
    function myAsyncFuncErrorCB(error, desc) {
        log_append("error: " + desc);
    }
    // call a function with list of numbers as arg
    mSession.call("MyDbus:myAsyncFunc", [1, 2, 3, 4, 5]).then(myAsyncFuncSuccessCB, myAsyncFuncErrorCB);
};

function log_append(message) {
    mLog.innerHTML += message + '\n';
    mLog.scrollTop = mLog.scrollHeight;
};