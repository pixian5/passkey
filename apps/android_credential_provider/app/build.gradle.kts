plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.pass.credentialprovider"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pass.credentialprovider"
        minSdk = 34
        targetSdk = 36
        versionCode = 107
        versionName = "1.0.7"
    }
}

dependencies {
    implementation("androidx.credentials:credentials:1.7.0-alpha02")
    implementation("androidx.core:core-ktx:1.17.0")

    testImplementation("junit:junit:4.13.2")
}
