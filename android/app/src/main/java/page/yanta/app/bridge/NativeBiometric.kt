package page.yanta.app.bridge

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Unlocking the app lock with fingerprint or face (Class 3 biometrics).
 *
 * An AES key in the Android Keystore that never leaves the secure hardware
 * and can only be used right after a successful biometric check wraps the
 * app lock's Local Data Key (src/lock/biometric-unlock.js). No passkey, no
 * account, nothing synced: the wrapped key only opens on this phone. A new
 * fingerprint enrolled on the phone invalidates the key — the web layer then
 * drops the wrapper and asks for the password once.
 */
object NativeBiometric {
    private const val KEY_ALIAS = "yanta_lock_biometric_v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    fun statusJson(activity: FragmentActivity): String {
        val result = BiometricManager.from(activity).canAuthenticate(BIOMETRIC_STRONG)
        return JSONObject()
            .put("available", result == BiometricManager.BIOMETRIC_SUCCESS)
            .put("enrolled", result != BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED)
            .put("hardware", result != BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE &&
                result != BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE)
            .put("hasKey", keyStore().containsAlias(KEY_ALIAS))
            .toString()
    }

    fun remove() {
        runCatching { keyStore().deleteEntry(KEY_ALIAS) }
    }

    /** Encrypts [secretB64] after a biometric check; result {iv, ct} or {error}. */
    fun encrypt(
        activity: FragmentActivity,
        secretB64: String,
        title: String,
        subtitle: String,
        cancel: String,
        done: (String) -> Unit,
    ) {
        val cipher = try {
            remove()
            Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, createKey()) }
        } catch (e: Exception) {
            done(error("keystore", e))
            return
        }

        prompt(activity, cipher, title, subtitle, cancel, done) { unlocked ->
            val ct = unlocked.doFinal(Base64.decode(secretB64, Base64.NO_WRAP))
            JSONObject()
                .put("iv", b64(unlocked.iv))
                .put("ct", b64(ct))
                .toString()
        }
    }

    /** Decrypts {iv, ct} after a biometric check; result {secret} or {error}. */
    fun decrypt(
        activity: FragmentActivity,
        ivB64: String,
        ctB64: String,
        title: String,
        subtitle: String,
        cancel: String,
        done: (String) -> Unit,
    ) {
        val cipher = try {
            val key = keyStore().getKey(KEY_ALIAS, null) as? SecretKey
                ?: return done(JSONObject().put("error", "nokey").toString())
            Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(ivB64, Base64.NO_WRAP)))
            }
        } catch (e: KeyPermanentlyInvalidatedException) {
            remove()
            done(JSONObject().put("error", "invalidated").toString())
            return
        } catch (e: Exception) {
            done(error("keystore", e))
            return
        }

        prompt(activity, cipher, title, subtitle, cancel, done) { unlocked ->
            val secret = unlocked.doFinal(Base64.decode(ctB64, Base64.NO_WRAP))
            JSONObject().put("secret", b64(secret)).toString()
        }
    }

    private fun prompt(
        activity: FragmentActivity,
        cipher: Cipher,
        title: String,
        subtitle: String,
        cancel: String,
        done: (String) -> Unit,
        onUnlocked: (Cipher) -> String,
    ) {
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val unlocked = result.cryptoObject?.cipher
                if (unlocked == null) {
                    done(JSONObject().put("error", "nocipher").toString())
                    return
                }
                done(runCatching { onUnlocked(unlocked) }.getOrElse { error("crypto", it) })
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                val cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                    errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    errorCode == BiometricPrompt.ERROR_CANCELED
                done(
                    JSONObject()
                        .put("error", if (cancelled) "cancelled" else "auth")
                        .put("message", errString.toString())
                        .toString()
                )
            }
        }

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButtonText(cancel)
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .setConfirmationRequired(false)
            .build()

        activity.runOnUiThread {
            BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
                .authenticate(info, BiometricPrompt.CryptoObject(cipher))
        }
    }

    private fun createKey(): SecretKey {
        val builder = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Every use needs a fresh strong biometric check.
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply { init(builder.build()) }
            .generateKey()
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun error(kind: String, e: Throwable): String =
        JSONObject().put("error", kind).put("message", e.message ?: e.javaClass.simpleName).toString()
}
