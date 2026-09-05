use aes_gcm::{aead::{Aead, KeyInit, OsRng}, Aes256Gcm, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;
use rand::RngCore;

fn main() {
    let hk = Hkdf::<Sha256>::new(None, b"shadow-grimoire-v1");
    let mut key = [0u8; 32];
    hk.expand(b"grimoire-master-key", &mut key).unwrap();
    let cipher = Aes256Gcm::new((&key).into());

    let n = 50000;
    let start = std::time::Instant::now();
    for i in 0..n {
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let nonce = Nonce::from_slice(&nonce);
        let _ = cipher.encrypt(nonce, format!("secret-value-{i}").as_bytes()).unwrap();
    }
    let elapsed = start.elapsed();
    println!("{} ops: {:.1} ms", n, elapsed.as_secs_f64() * 1000.0);
    println!("Per-op: {:.2} µs", elapsed.as_secs_f64() * 1e6 / n as f64);
}
