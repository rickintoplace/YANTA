plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    // Requires google-services.json in app/ (Firebase console → Android app).
    id("com.google.gms.google-services")
}

android {
    namespace = "page.yanta.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "page.yanta.app"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "YANTA_URL", "\"https://yanta.page\"")
        // Sygnal (Matrix push gateway) notify endpoint.
        buildConfigField(
            "String",
            "YANTA_PUSH_GATEWAY_URL",
            "\"https://push.yanta.page/_matrix/push/v1/notify\""
        )
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

    // Push notifications while the app is closed.
    implementation(platform("com.google.firebase:firebase-bom:34.16.0"))
    implementation("com.google.firebase:firebase-messaging")
}