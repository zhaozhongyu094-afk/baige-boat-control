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
    private boolean lightSkin;
    private BoatPicker picker;
    private boolean pageReady;
    private int insetTop;
    private boolean legacySession;
    private final Runnable legacyTimeout = () -> disconnect("控制刷新超时，已尝试停桨");

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        lightSkin = getPreferences(MODE_PRIVATE).getBoolean("lightSkin", true);
        updateSystemBars();
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
        web.setBackgroundColor(lightSkin ? 0xfff5f2ee : 0xff262d35);
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            int top = insets.getSystemWindowInsetTop();
            if (top != insetTop) {
                insetTop = top;
                syncInsets();
            }
            return v.onApplyWindowInsets(insets);
        });
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
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
        @JavascriptInterface public void lightAppearance(boolean light) {
            ui.post(() -> {
                if (lightSkin != light) {
                    lightSkin = light;
                    getPreferences(MODE_PRIVATE).edit().putBoolean("lightSkin", light).apply();
                    web.setBackgroundColor(light ? 0xfff5f2ee : 0xff262d35);
                    updateSystemBars();
                }
            });
        }
        @JavascriptInterface public void openDevices() {
            ui.post(() -> { if (foreground && link == null) picker.open(); });
        }
        @JavascriptInterface public void searchDevices() {
            ui.post(() -> { if (foreground && link == null) picker.search(); });
        }
        @JavascriptInterface public void closeDevices() { ui.post(picker::close); }
        @JavascriptInterface public void connectTo(String address, boolean legacy) {
            ui.post(() -> {
                if (foreground && link == null) {
                    legacySession = legacy;
                    picker.select(address);
                }
            });
        }
        @JavascriptInterface public void disconnectBoat() {
            ui.post(() -> { if (link != null) disconnect("已断开设备"); });
        }
        @JavascriptInterface public void fullscreen(boolean enabled) {
            ui.post(() -> displayMode(enabled));
        }
        @JavascriptInterface public void send(int token, String hex) { ui.post(() -> {
            if (link == null || token != generation || !foreground || hex == null) return;
            if (legacySession) {
                if (hex.length() != 2 || hex.charAt(0) != '3' || hex.charAt(1) < '1' || hex.charAt(1) > '5') return;
                byte command = (byte)hex.charAt(1);
                ui.removeCallbacks(legacyTimeout);
                if (command != '5') ui.postDelayed(legacyTimeout, 350);
                link.write(new byte[]{command});
                return;
            }
            if (hex.length() != 14) return;
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
    private void syncInsets() {
        if (!pageReady) return;
        int topDp = immersive ? 0 : Math.round(insetTop / getResources().getDisplayMetrics().density);
        web.evaluateJavascript("document.documentElement.style.setProperty('--status-inset','"+topDp+"px')", null);
    }
    private void displayMode(boolean enabled) {
        immersive = enabled;
        setRequestedOrientation(enabled ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        updateSystemBars();
        syncInsets();
        web.requestApplyInsets();
        web.evaluateJavascript("window.boatFullscreen && boatFullscreen("+enabled+")", null);
    }
    private void updateSystemBars() {
        int flags = immersive ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY :
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        if (lightSkin) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        getWindow().setNavigationBarColor(lightSkin && Build.VERSION.SDK_INT >= 26 ? 0xffedeae6 : 0xff262d35);
        getWindow().getDecorView().setSystemUiVisibility(flags);
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
        String name=picker.currentName(device);
        if (device.getType()==BluetoothDevice.DEVICE_TYPE_LE) {
            state("closed", "此设备仅支持低功耗蓝牙，船控连接需要经典蓝牙串口。");
            return;
        }
        generation++;
        int token=generation;
        state("connecting","正在连接 "+name);
        link=new BoatLink(legacySession, new BoatLink.Listener() {
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
        ui.removeCallbacks(legacyTimeout);
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
