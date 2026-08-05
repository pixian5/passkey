plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.pass.credentialprovider"
    compileSdk = 36

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.pass.credentialprovider"
        minSdk = 34
        targetSdk = 36
        versionCode = 152
        versionName = "1.5.2"
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.credentials:credentials:1.7.0-alpha02")
    implementation("androidx.core:core-ktx:1.17.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260719")
}
