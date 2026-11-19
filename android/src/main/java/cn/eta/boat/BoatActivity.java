package cn.eta.boat;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.view.View;
import android.bluetooth.*;
import android.os.*;
import android.view.WindowManager;
import android.webkit.*;
import org.json.JSONObject;
import org.json.JSONArray;

public final class BoatActivity extends Activity {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView web;
    private BluetoothAdapter adapter;
    private BoatLink link;
    private int generation;
    private boolean foreground, immersive;
    private BoatPicker picker;
    private boolean pageReady;
    private int insetTop;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        getWindow().setNavigationBarColor(0xff0b1930);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        BluetoothManager manager = getSystemService(BluetoothManager.class);
        adapter = manager == null ? null : manager.getAdapter();
        picker = new BoatPicker(this, adapter, new BoatPicker.Listener() {
            @Override public void display(JSONArray rows, String message, String action, boolean busy) {
                web.evaluateJavascript("window.boatDevices && boatDevices(" + rows + "," + JSONObject.quote(message)
                        + "," + JSONObject.quote(action) + "," + busy + ")", null);
            }
            @Override public void connect(BluetoothDevice device) { BoatActivity.this.connect(device); }
        });
        web = new WebView(this);
        web.setBackgroundColor(0xff233b56);
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            int top = insets.getSystemWindowInsetTop();
            if (top != insetTop) {
                insetTop = top;
                syncInsets();
            }
            return v.onApplyWindowInsets(insets);
        });
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setAllowFileAccessFromFileURLs(false);
        web.getSettings().setAllowUniversalAccessFromFileURLs(false);
        web.getSettings().setBlockNetworkLoads(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                pageReady = true;
                syncInsets();
                view.evaluateJavascript("window.boatFullscreen && boatFullscreen("+immersive+")", null);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) { return true; }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
        });
        web.addJavascriptInterface(new Bridge(), "BoatRadio");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    public final class Bridge {
        @JavascriptInterface public void openDevices() {
            ui.post(() -> { if (foreground && link == null) picker.open(); });
        }
        @JavascriptInterface public void searchDevices() {
            ui.post(() -> { if (foreground && link == null) picker.search(); });
        }
        @JavascriptInterface public void closeDevices() { ui.post(picker::close); }
        @JavascriptInterface public void connectTo(String address) {
            ui.post(() -> { if (foreground && link == null) picker.select(address); });
        }
        @JavascriptInterface public void disconnectBoat() {
            ui.post(() -> { if (link != null) disconnect("已断开设备"); });
        }
        @JavascriptInterface public void fullscreen(boolean enabled) {
            ui.post(() -> displayMode(enabled));
        }
        @JavascriptInterface public void send(int token, String hex) { ui.post(() -> {
            if (link == null || token != generation || !foreground || hex == null || hex.length() != 14) return;
            byte[] frame = new byte[7];
            try {
                for (int i=0; i<7; i++) frame[i]=(byte)Integer.parseInt(hex.substring(i*2,i*2+2),16);
                link.write(frame);
            } catch (NumberFormatException ignored) { }
        }); }
    }

    private void state(String kind,String detail) {
        web.evaluateJavascript("window.boatLink && boatLink("+JSONObject.quote(kind)+","+JSONObject.quote(detail)+","+generation+")",null);
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(code,permissions,results);
        if (code == BoatPicker.PERMISSIONS) picker.permissionsReturned(results);
    }
    @Override protected void onActivityResult(int code,int result,Intent data) {
        super.onActivityResult(code,result,data);
        if (code == BoatPicker.ENABLE) picker.enableReturned(result == RESULT_OK);
    }
    private static String deviceName(BluetoothDevice d) {
        String name = d.getName();
        return name == null ? d.getAddress() : name;
    }
    private void syncInsets() {
        if (!pageReady) return;
        int topDp = immersive ? 0 : Math.round(insetTop / getResources().getDisplayMetrics().density);
        web.evaluateJavascript("document.documentElement.style.setProperty('--status-inset','"+topDp+"px')", null);
    }
    private void displayMode(boolean enabled) {
        immersive = enabled;
        setRequestedOrientation(enabled ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        getWindow().getDecorView().setSystemUiVisibility(enabled ?
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY : View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        syncInsets();
        web.requestApplyInsets();
        web.evaluateJavascript("window.boatFullscreen && boatFullscreen("+enabled+")", null);
    }
    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && immersive && web != null) displayMode(true);
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("window.boatBack ? boatBack() : false", handled -> {
            if ("true".equals(handled)) return;
            if (immersive) displayMode(false);
            else BoatActivity.super.onBackPressed();
        });
    }
    private void connect(BluetoothDevice device) {
        if (!foreground) return;
        generation++;
        int token=generation;
        String name=deviceName(device);
        state("connecting","正在连接 "+name);
        link=new BoatLink(new BoatLink.Listener() {
            public void opened() { if (token==generation) state("open",name); }
            public void failed(String why) { if (token==generation) disconnect(why); }
            public void received(byte[] bytes) {
                if (token!=generation) return;
                StringBuilder hex=new StringBuilder(bytes.length*2);
                for(byte b:bytes) { hex.append(Character.forDigit((b>>4)&15,16)); hex.append(Character.forDigit(b&15,16)); }
                web.evaluateJavascript("window.boatRx && boatRx("+token+",'"+hex+"')",null);
            }
        });
        link.start(device);
    }
    private void disconnect(String why) {
        generation++;
        if(link!=null) { link.close(); link=null; }
        state("closed",why);
    }
    @Override protected void onResume() {
        super.onResume(); foreground=true; web.onResume(); picker.resume();
    }
    @Override protected void onStop() {
        picker.stop(); super.onStop();
    }
    @Override protected void onPause() {
        foreground=false;
        picker.pause();
        if (pageReady) web.evaluateJavascript("window.boatSuspend && boatSuspend()",null);
        if(link!=null) disconnect("已断开，重新连接后可操控");
        web.onPause(); super.onPause();
    }
    @Override protected void onDestroy() {
        picker.destroy();
        if(link!=null) link.close();
        ui.removeCallbacksAndMessages(null); web.removeJavascriptInterface("BoatRadio"); web.destroy(); super.onDestroy();
    }
}