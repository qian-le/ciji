package com.ciji.wordtrail;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "CijiUpdater")
public class CijiUpdaterPlugin extends Plugin {

    private long downloadId = -1L;

    @PluginMethod
    public void getBuildInfo(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageManager pm = ctx.getPackageManager();
            PackageInfo pInfo = pm.getPackageInfo(ctx.getPackageName(), 0);
            int versionCode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                versionCode = (int) pInfo.getLongVersionCode();
            } else {
                //noinspection deprecation
                versionCode = pInfo.versionCode;
            }
            JSObject result = new JSObject();
            result.put("versionCode", versionCode);
            result.put("versionName", pInfo.versionName == null ? "1.0.0" : pInfo.versionName);
            result.put("packageName", ctx.getPackageName());
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "build info failed" : e.getMessage(), e);
        }
    }

    @PluginMethod
    public void downloadApk(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url required");
            return;
        }
        final String fileName = call.getString("fileName") != null ? call.getString("fileName") : "ciji-update.apk";
        final Context ctx = getContext();
        File base = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (base == null) {
            base = ctx.getFilesDir();
        }
        final File dir = new File(base, "updates");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        final File dest = new File(dir, fileName);
        if (dest.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dest.delete();
        }

        final DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                .setTitle("Ciji update")
                .setDescription("Downloading APK")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationUri(Uri.fromFile(dest))
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true);
        downloadId = dm.enqueue(request);

        final File finalDest = dest;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    while (true) {
                        DownloadManager.Query q = new DownloadManager.Query().setFilterById(downloadId);
                        Cursor cursor = dm.query(q);
                        if (!cursor.moveToFirst()) {
                            cursor.close();
                            break;
                        }
                        int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        long received = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        int percent = total > 0 ? (int) ((received * 100) / total) : 0;
                        JSObject progress = new JSObject();
                        progress.put("received", received);
                        progress.put("total", total);
                        progress.put("percent", percent);
                        notifyListeners("downloadProgress", progress);
                        cursor.close();

                        if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            JSObject result = new JSObject();
                            result.put("path", finalDest.getAbsolutePath());
                            result.put("size", finalDest.length());
                            call.resolve(result);
                            return;
                        }
                        if (status == DownloadManager.STATUS_FAILED) {
                            call.reject("download failed");
                            return;
                        }
                        Thread.sleep(400);
                    }
                    if (finalDest.exists() && finalDest.length() > 0) {
                        JSObject result = new JSObject();
                        result.put("path", finalDest.getAbsolutePath());
                        result.put("size", finalDest.length());
                        call.resolve(result);
                    } else {
                        call.reject("download incomplete");
                    }
                } catch (Exception e) {
                    call.reject(e.getMessage() == null ? "download error" : e.getMessage(), e);
                }
            }
        }).start();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("path required");
            return;
        }
        File file = new File(path);
        if (!file.exists()) {
            call.reject("apk not found");
            return;
        }
        try {
            Context ctx = getContext();
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                ctx.startActivity(intent);
            }
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "install failed" : e.getMessage(), e);
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        try {
            if (downloadId != -1L) {
                Context ctx = getContext();
                DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
                dm.remove(downloadId);
                downloadId = -1L;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "cancel failed" : e.getMessage(), e);
        }
    }
}
