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
    // Keep all reported addresses, including devices whose name has not arrived yet.
    private final Map<String,String> nearby = new TreeMap<>();
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

    String currentName(BluetoothDevice device) {
        String name = device.getName();
        if (name == null || name.trim().isEmpty()) name = nearby.get(device.getAddress());
        return name == null || name.trim().isEmpty() ? "未命名设备" : name;
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
        Map<String,String> names = new TreeMap<>(nearby);
        Set<String> bonded = new HashSet<>();
        for (BluetoothDevice device : radio.getBondedDevices()) {
            String address=device.getAddress();
            if (!names.containsKey(address)) names.put(address,currentName(device));
            bonded.add(address);
        }
        JSONArray list=new JSONArray();
        for (Map.Entry<String,String> row : names.entrySet()) {
            String address=row.getKey();
            boolean leOnly=radio.getRemoteDevice(address).getType()==BluetoothDevice.DEVICE_TYPE_LE;
            list.put(new JSONArray().put(row.getValue()).put(address).put(bonded.contains(address))
                .put(pairing!=null && pairing.getAddress().equals(address)).put(leOnly));
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
        nearby.clear();
        ui.postDelayed(scanTimeout, 25000);
        say("正在搜索附近的蓝牙设备…");
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
        say(empty ? (Build.VERSION.SDK_INT<31 ? "未发现设备，请确认设备可被发现并开启手机定位后重试。" :
            "未发现设备，请确认设备已开启且可被发现后重试。") : "搜索完成");
    }

    void select(String address) {
        if (!visible || !resumed || pairing!=null || radio==null || !canConnect() || address==null || !BluetoothAdapter.checkBluetoothAddress(address)) return;
        try {
            BluetoothDevice device=radio.getRemoteDevice(address);
            boolean bonded=device.getBondState()==BluetoothDevice.BOND_BONDED;
            if (!radio.isEnabled() || (!bonded && !nearby.containsKey(address))) {
                say("这台设备当前不可用，请手动搜索。"); return;
            }
            if (device.getType()==BluetoothDevice.DEVICE_TYPE_LE) {
                say("此设备仅支持低功耗蓝牙，船控连接需要经典蓝牙串口。"); return;
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
            if (state==BluetoothAdapter.STATE_OFF) { stopScan(false); nearby.clear();pairFailed("蓝牙已关闭"); }
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
            } else say(message);
            return;
        }
        if (BluetoothDevice.ACTION_FOUND.equals(event) && scanning) waitingForStart=false;
        else if (!rename || (!nearby.containsKey(address) && device.getBondState()!=BluetoothDevice.BOND_BONDED)) return;
        String name=intent.getStringExtra(BluetoothDevice.EXTRA_NAME);
        if (name==null || name.trim().isEmpty()) name=currentName(device);
        if (!Objects.equals(nearby.put(address,name),name)) say(message);
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
