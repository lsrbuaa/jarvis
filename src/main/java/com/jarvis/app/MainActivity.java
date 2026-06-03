package com.jarvis.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity implements SensorEventListener {
    private static final int REQUEST_FILE_CHOOSER = 72;
    private static final int REQUEST_CAMERA_PERMISSION = 73;

    private WebView webView;
    private SensorManager sensorManager;
    private Sensor accelerometerSensor;
    private Sensor gyroscopeSensor;
    private Sensor lightSensor;
    private ValueCallback<Uri[]> filePathCallback;

    private final float[] accelerometer = new float[] {0f, 0f, 0f};
    private final float[] gyroscope = new float[] {0f, 0f, 0f};
    private float light = -1f;
    private long sensorUpdatedAt = 0L;
    private long lastSensorDispatchAt = 0L;
    private boolean sensorsRunning = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestCameraPermissionIfNeeded();

        sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        if (sensorManager != null) {
            accelerometerSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            gyroscopeSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
            lightSensor = sensorManager.getDefaultSensor(Sensor.TYPE_LIGHT);
        }

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        webView.setBackgroundColor(Color.rgb(242, 245, 248));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        request.grant(request.getResources());
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                    return true;
                } catch (Exception error) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        JarvisBridge bridge = new JarvisBridge();
        webView.addJavascriptInterface(bridge, "JarvisAndroid");
        webView.addJavascriptInterface(bridge, "NoriAndroid");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        startSensors();
    }

    @Override
    protected void onPause() {
        stopSensors();
        super.onPause();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER && filePathCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event == null || event.sensor == null) {
            return;
        }
        int type = event.sensor.getType();
        if (type == Sensor.TYPE_ACCELEROMETER) {
            copy3(event.values, accelerometer);
        } else if (type == Sensor.TYPE_GYROSCOPE) {
            copy3(event.values, gyroscope);
        } else if (type == Sensor.TYPE_LIGHT && event.values.length > 0) {
            light = event.values[0];
        }
        sensorUpdatedAt = System.currentTimeMillis();
        dispatchSensorSnapshot(false);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // Accuracy is intentionally not surfaced in the prototype UI.
    }

    private void requestCameraPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.CAMERA}, REQUEST_CAMERA_PERMISSION);
        }
    }

    private void startSensors() {
        if (sensorManager == null || sensorsRunning) {
            return;
        }
        if (accelerometerSensor != null) {
            sensorManager.registerListener(this, accelerometerSensor, SensorManager.SENSOR_DELAY_UI);
        }
        if (gyroscopeSensor != null) {
            sensorManager.registerListener(this, gyroscopeSensor, SensorManager.SENSOR_DELAY_UI);
        }
        if (lightSensor != null) {
            sensorManager.registerListener(this, lightSensor, SensorManager.SENSOR_DELAY_NORMAL);
        }
        sensorsRunning = true;
    }

    private void stopSensors() {
        if (sensorManager != null && sensorsRunning) {
            sensorManager.unregisterListener(this);
        }
        sensorsRunning = false;
    }

    private void dispatchSensorSnapshot(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastSensorDispatchAt < 750L) {
            return;
        }
        lastSensorDispatchAt = now;
        if (webView == null) {
            return;
        }
        final String payload = buildSensorSnapshot().toString();
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.__jarvisSensorUpdate && window.__jarvisSensorUpdate(" + JSONObject.quote(payload) + ")",
                null
        ));
    }

    private JSONObject buildSensorSnapshot() {
        JSONObject payload = new JSONObject();
        try {
            payload.put("accelerometer", new JSONArray()
                    .put(round(accelerometer[0]))
                    .put(round(accelerometer[1]))
                    .put(round(accelerometer[2])));
            payload.put("gyroscope", new JSONArray()
                    .put(round(gyroscope[0]))
                    .put(round(gyroscope[1]))
                    .put(round(gyroscope[2])));
            payload.put("light", light < 0 ? JSONObject.NULL : round(light));
            payload.put("motion", round(Math.sqrt(
                    accelerometer[0] * accelerometer[0]
                            + accelerometer[1] * accelerometer[1]
                            + accelerometer[2] * accelerometer[2]
            )));
            payload.put("battery", readBatteryLevel());
            payload.put("updatedAt", sensorUpdatedAt);
            payload.put("running", sensorsRunning);
        } catch (Exception ignored) {
            // JSONObject writes above are type-safe for this payload.
        }
        return payload;
    }

    private int readBatteryLevel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            BatteryManager batteryManager = (BatteryManager) getSystemService(BATTERY_SERVICE);
            if (batteryManager != null) {
                int level = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                if (level >= 0) {
                    return level;
                }
            }
        }
        return -1;
    }

    private void copy3(float[] source, float[] target) {
        for (int i = 0; i < 3 && i < source.length; i++) {
            target[i] = source[i];
        }
    }

    private double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private class JarvisBridge {
        @JavascriptInterface
        public String getSensorSnapshot() {
            dispatchSensorSnapshot(true);
            return buildSensorSnapshot().toString();
        }

        @JavascriptInterface
        public void startSensorStream() {
            runOnUiThread(() -> {
                startSensors();
                dispatchSensorSnapshot(true);
            });
        }

        @JavascriptInterface
        public void stopSensorStream() {
            runOnUiThread(MainActivity.this::stopSensors);
        }

        @JavascriptInterface
        public void chatCompletions(String baseUrl, String apiKey, String body, String callbackId) {
            postJson(baseUrl, apiKey, "chat/completions", body, callbackId);
        }

        @JavascriptInterface
        public void postJson(String baseUrl, String apiKey, String path, String body, String callbackId) {
            new Thread(() -> {
                boolean ok = false;
                String payload;
                try {
                    String cleanPath = path == null ? "" : path.trim();
                    while (cleanPath.startsWith("/")) {
                        cleanPath = cleanPath.substring(1);
                    }
                    String endpoint = normalizeBaseUrl(baseUrl) + "/" + cleanPath;
                    HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
                    connection.setConnectTimeout(20000);
                    connection.setReadTimeout(90000);
                    connection.setRequestMethod("POST");
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    if (apiKey != null && !apiKey.trim().isEmpty()) {
                        connection.setRequestProperty("Authorization", "Bearer " + apiKey.trim());
                    }

                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(bytes);
                    }

                    int code = connection.getResponseCode();
                    ok = code >= 200 && code < 300;
                    InputStream input = ok ? connection.getInputStream() : connection.getErrorStream();
                    payload = readFully(input);
                    connection.disconnect();
                } catch (Exception error) {
                    payload = "{\"error\":{\"message\":" + JSONObject.quote(error.getMessage()) + "}}";
                }

                final boolean finalOk = ok;
                final String finalPayload = payload == null ? "" : payload;
                runOnUiThread(() -> {
                    String script = "window.__jarvisNativeCallback && window.__jarvisNativeCallback("
                            + JSONObject.quote(callbackId) + ","
                            + finalOk + ","
                            + JSONObject.quote(finalPayload)
                            + ")";
                    webView.evaluateJavascript(script, null);
                });
            }).start();
        }

        private String normalizeBaseUrl(String raw) {
            String url = raw == null ? "" : raw.trim();
            while (url.endsWith("/")) {
                url = url.substring(0, url.length() - 1);
            }
            if (url.endsWith("/chat/completions")) {
                return url.substring(0, url.length() - "/chat/completions".length());
            }
            return url;
        }

        private String readFully(InputStream input) throws Exception {
            if (input == null) {
                return "";
            }
            StringBuilder builder = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    builder.append(line);
                }
            }
            return builder.toString();
        }
    }
}
