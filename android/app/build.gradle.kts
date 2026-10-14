import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    // Requires google-services.json in app/ (Firebase console → Android app).
    id("com.google.gms.google-services")
}

android {
    namespace = "page.yanta.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "page.yanta.app"
        minSdk = 29
        // Google Play: new apps and updates must target API 36 from 2026-08-31.
        targetSdk = 36
        versionCode = 2
        versionName = "1.1.0"
        buildConfigField("String", "YANTA_URL", "\"https://yanta.page\"")
        // Sygnal (Matrix push gateway) notify endpoint.
        buildConfigField(
            "String",
            "YANTA_PUSH_GATEWAY_URL",
            "\"https://push.yanta.page/_matrix/push/v1/notify\""
        )
    }

    /*
     * Release signing: the Play *upload* key. With Play App Signing, Google
     * signs what users install; this key only proves uploads come from us.
     * It lives outside the repo (~/.yanta-release, see PLAY_RELEASE.md);
     * without it, release builds stay unsigned and debug builds still work.
     */
    val releaseKeystore = Properties().apply {
        val file = listOf(
            rootProject.file("keystore.properties"),
            File(System.getProperty("user.home"), ".yanta-release/keystore.properties"),
        ).firstOrNull { it.exists() }
        if (file != null) file.inputStream().use { load(it) }
    }

    signingConfigs {
        if (releaseKeystore.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(releaseKeystore.getProperty("storeFile"))
                storePassword = releaseKeystore.getProperty("storePassword")
                keyAlias = releaseKeystore.getProperty("keyAlias")
                keyPassword = releaseKeystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core-splashscreen:1.0.1")

    // App lock: fingerprint / face via Keystore-bound keys (NativeBiometric.kt).
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.fragment:fragment-ktx:1.8.5")

    // Push notifications while the app is closed.
    implementation(platform("com.google.firebase:firebase-bom:34.16.0"))
    implementation("com.google.firebase:firebase-messaging")
}