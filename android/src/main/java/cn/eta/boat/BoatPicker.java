package cn.eta.boat;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;

/** Classic Bluetooth discovery and bonding for the device sheet. All calls run on the main thread. */
final class BoatPicker {
    interface Listener {
        void display(JSONArray rows, String message, String action, boolean busy);
        void connect(BluetoothDevice device);
    }

    private enum Action { NONE, OPEN, SEARCH }
    static final int PERMISSIONS = 71, ENABLE = 72;
    private final Activity activity;
    private final BluetoothAdapter radio;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());
    // Remember matching local discoveries between visits to the sheet. A new search replaces them.
    private final Map<String,String> nearby = new TreeMap<>();
    private final Set<String> seen = new HashSet<>();
    private boolean visible, resumed, registered, scanning, ownScan, waitingForStart, waitingPermission, waitingEnable;
    private Action action = Action.NONE;
    private BluetoothDevice pairing;
    private String message = "";
    private final Runnable scanTimeout = () -> { if (scanning) { stopScan(false); finishScan(); } };
    private final Runnable pairTimeout = () -> { if (pairing != null) pairFailed("配对超时，可再次点选船模。"); };

    BoatPicker(Activity activity, BluetoothAdapter radio, Listener listener) {
        this.activity = activity;
        this.radio = radio;
        this.listener = listener;
    }

    static final String TARGET_NAME = "jdy-31-spp";
    static boolean accepts(String name, int type) {
        return type != BluetoothDevice.DEVICE_TYPE_LE && TARGET_NAME.equalsIgnoreCase(name);
    }
    String currentName(BluetoothDevice device) {
        String name = device.getName();
        return name != null ? name : nearby.get(device.getAddress());
    }

    void open() {
        if (visible) return;
        visible = true;
        action = Action.OPEN;
        message = "";
        advance();
    }

    void search() {
        if (!visible || scanning || pairing != null || waitingPermission || waitingEnable) return;
        action = Action.SEARCH;
        advance();
    }

    private boolean granted(String permission) {
        return activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean canConnect() {
        return Build.VERSION.SDK_INT < 31 || granted(Manifest.permission.BLUETOOTH_CONNECT);
    }

    private String scanPermission() {
        return Build.VERSION.SDK_INT >= 31 ? Manifest.permission.BLUETOOTH_SCAN : Manifest.permission.ACCESS_FINE_LOCATION;
    }

    private void request(String permission) {
        waitingPermission = true;
        activity.requestPermissions(new String[]{permission}, PERMISSIONS);
    }

    private void advance() {
        if (!visible || !resumed || action == Action.NONE || waitingPermission || waitingEnable) return;
        try {
            if (radio == null) { action=Action.NONE; say("此设备没有蓝牙，可继续模拟。"); return; }
            if (!canConnect()) { request(Manifest.permission.BLUETOOTH_CONNECT); return; }
            register();
            if (!radio.isEnabled()) {
                if (radio.getState() == BluetoothAdapter.STATE_TURNING_ON) { say("正在开启蓝牙…"); return; }
                nearby.clear();
                if (action == Action.SEARCH) {
                    waitingEnable=true;
                    activity.startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), ENABLE);
                } else { action=Action.NONE; say("蓝牙未开启，可以在此开启蓝牙。"); }
                return;
            }
            JSONArray rows = rows();
            if (action == Action.OPEN && rows.length() > 0) {
                action=Action.NONE; say(""); return;
            }
            if (!granted(scanPermission())) { request(scanPermission()); return; }
            action=Action.NONE;
            startScan();
        } catch (SecurityException | android.content.ActivityNotFoundException e) {
            action=Action.NONE; waitingEnable=false; say("蓝牙操作未获允许，可重试或继续模拟。");
        }
    }

    private JSONArray rows() {
        Map<String,String> names = new TreeMap<>();
        Set<String> bonded = new HashSet<>();
        for (String address : nearby.keySet()) {
            BluetoothDevice device=radio.getRemoteDevice(address);
            String name=currentName(device);
            if (accepts(name,device.getType())) names.put(address,name);
        }
        for (BluetoothDevice device : radio.getBondedDevices()) {
            String address=device.getAddress(), name=currentName(device);
            if (accepts(name,device.getType())) { names.put(address,name); bonded.add(address); }
            else names.remove(address);
        }
        JSONArray list=new JSONArray();
        for (Map.Entry<String,String> row : names.entrySet()) {
            list.put(new JSONArray().put(row.getValue()).put(row.getKey()).put(bonded.contains(row.getKey()))
                .put(pairing!=null && pairing.getAddress().equals(row.getKey())));
        }
        return list;
    }

    private void say(String text) {
        message=text;
        if (!visible) return;
        JSONArray devices=new JSONArray();
        String button="搜索设备";
        try {
            if (radio!=null && canConnect()) {
                if (radio.isEnabled()) devices=rows(); else button="开启蓝牙";
            }
        } catch (SecurityException ignored) { }
        listener.display(devices,text,button,scanning || pairing!=null || radio==null);
    }

    private void startScan() {
        if (scanning) return;
        boolean existing=radio.isDiscovering();
        if (!existing && !radio.startDiscovery()) {
            say("搜索未能开始，请稍后手动重试。"); return;
        }
        scanning=true; ownScan=!existing; waitingForStart=!existing;
        seen.clear(); nearby.clear();
        ui.postDelayed(scanTimeout, 25000);
        say("正在搜索 " + TARGET_NAME + "…");
    }

    private void stopScan(boolean connecting) {
        boolean cancel=ownScan || connecting;
        scanning=false; ownScan=false; waitingForStart=false;
        ui.removeCallbacks(scanTimeout);
        try {
            if (cancel && radio!=null && (Build.VERSION.SDK_INT<31 || granted(Manifest.permission.BLUETOOTH_SCAN))) radio.cancelDiscovery();
        } catch (SecurityException ignored) { }
    }

    private void finishScan() {
        boolean empty;
        try { empty=canConnect() && rows().length()==0; }
        catch (SecurityException e) { say("蓝牙权限已变化，请重新打开连接面板。"); return; }
        say(empty ? "未找到 " + TARGET_NAME + (Build.VERSION.SDK_INT<31 ? "，请确认模块可被发现并开启手机定位后重试。" :
            "，请确认模块名称和供电后手动搜索。") : "搜索完成");
    }

    void select(String address) {
        if (!visible || !resumed || pairing!=null || radio==null || !canConnect() || address==null || !BluetoothAdapter.checkBluetoothAddress(address)) return;
        try {
            BluetoothDevice device=radio.getRemoteDevice(address);
            String name=currentName(device);
            boolean bonded=device.getBondState()==BluetoothDevice.BOND_BONDED;
            if (!radio.isEnabled() || !accepts(name,device.getType()) || (!bonded && !nearby.containsKey(address))) {
                say("这台设备当前不可用，请手动搜索。"); return;
            }
            stopScan(true);
            if (bonded) { close(); listener.connect(device); return; }
            pairing=device;
            if (device.getBondState()!=BluetoothDevice.BOND_BONDING && !device.createBond()) {
                pairFailed("无法开始配对，可再次点选船模。"); return;
            }
            ui.postDelayed(pairTimeout,75000);
            say("正在配对，请确认系统配对请求。");
        } catch (SecurityException e) { pairFailed("没有蓝牙权限，可重试或继续模拟。"); }
    }

    private void checkPair() {
        if (visible && resumed && pairing!=null && pairing.getBondState()==BluetoothDevice.BOND_BONDED) {
            BluetoothDevice device=pairing;
            if (!accepts(currentName(device),device.getType())) {
                pairFailed("设备名称已改变，请手动搜索。"); return;
            }
            close(); listener.connect(device);
        }
    }
    private void pairFailed(String why) {
        pairing=null; ui.removeCallbacks(pairTimeout); say(why);
    }
    private final BroadcastReceiver events = new BroadcastReceiver() {
        @Override public void onReceive(Context ctx,Intent intent) {
            try { handle(intent); }
            catch (SecurityException e) { action=Action.NONE; stopScan(false); pairFailed("蓝牙权限已变化，请重新打开连接面板。"); }
        }
    };

    private void handle(Intent intent) {
        String event=intent.getAction();
        if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(event)) {
            int state=intent.getIntExtra(BluetoothAdapter.EXTRA_STATE,BluetoothAdapter.ERROR);
            if (state==BluetoothAdapter.STATE_OFF) { stopScan(false); nearby.clear();seen.clear();pairFailed("蓝牙已关闭"); }
            else if (visible && state==BluetoothAdapter.STATE_ON) { say(""); advance(); }
            return;
        }
        boolean rename = BluetoothDevice.ACTION_NAME_CHANGED.equals(event);
        if ((!visible && !rename) || !canConnect()) return;
        if (BluetoothAdapter.ACTION_DISCOVERY_STARTED.equals(event)) {
            waitingForStart=false; return;
        }
        if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(event)) {
            if (scanning && !waitingForStart && !radio.isDiscovering()) {
                ownScan=false; stopScan(false); finishScan();
            }
            return;
        }
        BluetoothDevice device=intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        if (device==null) return;
        String address=device.getAddress();
        if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(event)) {
            if (device.equals(pairing)) {
                int bond=intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE,BluetoothDevice.ERROR);
                if (bond==BluetoothDevice.BOND_NONE) pairFailed("配对已取消或未成功，可重新点选。");
                else if (bond==BluetoothDevice.BOND_BONDED) checkPair();
            } else if (accepts(device.getName(),device.getType()) || nearby.containsKey(address)) say(message);
            return;
        }
        if (BluetoothDevice.ACTION_FOUND.equals(event) && scanning) { waitingForStart=false; seen.add(address); }
        else if (!rename || (!seen.contains(address) && !nearby.containsKey(address))) return;
        String name=intent.getStringExtra(BluetoothDevice.EXTRA_NAME);
        if (name==null) name=device.getName();
        if (accepts(name,device.getType())) {
            if (!Objects.equals(nearby.put(address,name),name)) say(scanning ? message : "");
        } else if (name!=null && nearby.remove(address)!=null) say(message);
    }

    private void register() {
        if (registered) return;
        IntentFilter f=new IntentFilter();
        f.addAction(BluetoothDevice.ACTION_FOUND);f.addAction(BluetoothDevice.ACTION_NAME_CHANGED);
        f.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);f.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        f.addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED);f.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        // The privileged Bluetooth system service can run outside the system UID.
        if (Build.VERSION.SDK_INT>=33) activity.registerReceiver(events,f,Context.RECEIVER_EXPORTED);
        else activity.registerReceiver(events,f);
        registered=true;
    }

    void permissionsReturned(int[] results) {
        waitingPermission=false;
        if (results.length==0 || results[0]!=PackageManager.PERMISSION_GRANTED) {
            action=Action.NONE; say("蓝牙权限未授予，可点搜索重试或继续模拟。"); return;
        }
        advance();
    }
    void enableReturned(boolean ok) {
        waitingEnable=false;
        if (!ok) { action=Action.NONE; say("蓝牙未开启，可继续模拟。"); return; }
        advance();
    }
    void resume() {
        resumed=true;
        try { if(canConnect()) checkPair(); advance(); }
        catch (SecurityException e) { pairFailed("无法读取配对状态，请重试。"); }
    }
    void pause() { resumed=false; }
    void stop() {
        if (scanning) { stopScan(false); say("搜索已停止，可手动再次搜索。"); }
    }
    void close() {
        visible=false; action=Action.NONE; pairing=null;
        ui.removeCallbacks(pairTimeout); stopScan(false);
    }
    void destroy() {
        close();
        if (registered) { activity.unregisterReceiver(events); registered=false; }
    }
}
