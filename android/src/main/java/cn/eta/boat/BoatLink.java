package cn.eta.boat;

import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** One RFCOMM session. All state except closed is owned by the main looper. */
final class BoatLink {
    interface Listener {
        void opened();
        void failed(String reason);
        void received(byte[] bytes);
    }
    private static final UUID SPP=UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private static final byte[] STOP={(byte)255,1,0,100,100,8,12};
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final ExecutorService sender=Executors.newSingleThreadExecutor();
    private final Listener listener;
    private final byte[] sessionStop;
    private BluetoothSocket socket;
    private OutputStream output;
    private boolean busy;
    private volatile boolean closed;
    private byte[] latest;
    private long latestAt;
    private final Runnable connectTimeout=()->fail("连接超时，请检查船模供电");
    private final Runnable writeTimeout=()->fail("蓝牙写入超时，已断开");

    BoatLink(boolean legacy, Listener listener) {
        this.listener=listener;
        sessionStop=legacy ? new byte[]{'5'} : STOP;
    }
    void start(BluetoothDevice device) {
        try { socket=device.createRfcommSocketToServiceRecord(SPP); }
        catch (IOException | SecurityException e) { fail("无法打开蓝牙串口"); return; }
        BluetoothSocket peer=socket;
        ui.postDelayed(connectTimeout,15000);
        Thread receiver=new Thread(()->{
            try {
                peer.connect();
                InputStream input=peer.getInputStream();
                OutputStream sink=peer.getOutputStream();
                ui.post(()->{
                    if(closed) return;
                    ui.removeCallbacks(connectTimeout);
                    output=sink; listener.opened();
                });
                byte[] buf=new byte[128]; int count;
                while (!closed && (count=input.read(buf))!=-1) {
                    byte[] bytes=Arrays.copyOf(buf,count);
                    ui.post(()->{if(!closed) listener.received(bytes);});
                }
                ui.post(()->fail("蓝牙已断开"));
            } catch (IOException | SecurityException e) { ui.post(()->fail("蓝牙连接已中断")); }
        },"boat-rfcomm-reader");
        receiver.start();
    }
    void write(byte[] frame) {
        if (closed || output==null) return;
        if (busy) {
            // A legacy OK has no sequence number. Never replace an unacknowledged digit.
            if (frame.length==1 && latest!=null) { fail("旧船串口写入积压，已尝试停桨"); return; }
            latest=frame; latestAt=SystemClock.elapsedRealtime(); return;
        }
        busy=true;
        OutputStream sink=output;
        ui.postDelayed(writeTimeout,300);
        sender.execute(()->{
            try {
                if (!closed) sink.write(frame);
                ui.post(()->{
                    if (closed) return;
                    ui.removeCallbacks(writeTimeout);
                    busy=false;
                    byte[] next=latest; latest=null;
                    if (next!=null) {
                        boolean stop = next.length==1 ? next[0]=='5' : next[3]==100 && next[4]==100;
                        if (stop || SystemClock.elapsedRealtime()-latestAt < 100) write(next);
                        else if (next.length==1) fail("旧船点动指令已过期，已尝试停桨");
                    }
                });
            } catch (IOException e) { ui.post(()->fail("蓝牙发送失败")); }
        });
    }
    private void fail(String why) { if (!closed) listener.failed(why); }
    void close() {
        if(closed) return;
        closed=true; latest=null;
        ui.removeCallbacks(connectTimeout); ui.removeCallbacks(writeTimeout);
        BluetoothSocket peer=socket;
        OutputStream sink=output;
        // A zero frame follows any in-flight write. Socket close also unblocks stalled I/O.
        if (sink!=null) sender.execute(()->{try { sink.write(sessionStop); } catch(IOException ignored) {}});
        sender.shutdown();
        if(peer!=null) ui.postDelayed(()->{try {peer.close();} catch(IOException ignored) {}},sink==null?0:35);
    }
}
