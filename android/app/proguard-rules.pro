# The web layer calls these by name through window.YantaAndroid.
-keepclassmembers class page.yanta.app.bridge.YantaJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# Keep line numbers readable in Play Console crash reports.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
