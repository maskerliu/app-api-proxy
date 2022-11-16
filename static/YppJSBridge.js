(function bridge() {
    if (window._YPP_JS_BRIDGE_) {
        return;
    }

    var uniqueId = 1;
    var responseCallbacks = {};

    function generateCallbackId(message, callback) {
        if (callback) {
            var callbackId = 'cb_' + (uniqueId++) + '_' + new Date().getTime();

            responseCallbacks[callbackId] = callback;
            message.callbackId = callbackId;
        }
    }

    function call(action, params, callback) {
        var message = {
            action: action,
            params: params,
        };
        generateCallbackId(message, callback);
        // Android可以支持直接使用这种方法调用
        const encodeMessageJson = encodeURIComponent(JSON.stringify(message));

        prompt('bridge://yupaopao.com?message=' + encodeMessageJson, "");
    }

    function callbackToWeb(jsonData) {
        jsonData = JSON.parse(jsonData);

        if (jsonData.callbackId) {
            var responseCallback = responseCallbacks[jsonData.callbackId];

            if (!responseCallback) {
                return;
            }

            responseCallback(jsonData.responseData);

            delete responseCallbacks[jsonData.callbackId];
        }
    }

    window._YPP_JS_BRIDGE_ = {
        call: call,
        callbackToWeb: callbackToWeb,
        onRefresh: function() {
          window.onYppRefresh && window.onYppRefresh()
        },
    };

    var event = new Event('YppJsBridgeReady');
    document.dispatchEvent(event);
})();