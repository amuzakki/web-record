# Product Requirements Document (PRD): OpenJam GitHub Pages Auto-Publisher

## Execution Checklist (Untuk AI Agent)
- [x] **Task 1:** Update `manifest.json` (permissions `storage`, `clipboardWrite`, dan `options_ui`) serta pastikan bundler menyalin file options ke folder output build.
- [x] **Task 2:** Buat `options.html` dan `options.js` dengan form konfigurasi `chrome.storage.local` (`openjam_github_config`) dan tombol Tes Koneksi GitHub API.
- [x] **Task 3:** Buat modul `src/utils/githubUploader.js` dengan UTF-8 Base64 encoder dan uploader `PUT /repos/{owner}/{repo}/contents/reports/{file}`.
- [x] **Task 4:** Integrasikan tombol "Upload to GitHub" dan auto-copy link GitHub Pages ke dalam komponen UI / fungsi export HTML OpenJam.
- [x] **Task 5:** Buat folder `github-pages-template/` berisi `scripts/generate-index.js`, `.github/workflows/build-index.yml`, dan `reports/.gitkeep`.
- [x] **Verifikasi:** Jalankan `npm install` (jika `node_modules` belum ada) dan `npm run build` hingga sukses tanpa error.

## Execution Checklist Fase 2: Refactor ke Single-Repo (`docs/` & Root Workflows)

Lakukan pembaruan arsitektur berikut agar kode ekstensi dan publikasi GitHub Pages berjalan dalam 1 repositori yang sama menggunakan folder `docs/`:

- [x] **Task 6 (Update Uploader Path):** Perbarui `src/utils/githubUploader.js` agar target path upload di GitHub API menjadi `docs/reports/${fileName}` (bukan `reports/${fileName}`), sementara return URL publik GitHub Pages tetap `${pagesBaseUrl}/reports/${fileName}`.
- [x] **Task 7 (Migrasi File GitHub Pages ke `docs/` & Root):**
  - Pindahkan isi dari `github-pages-template/.github/workflows/build-index.yml` ke `.github/workflows/build-index.yml` di root repositori (jika sudah ada folder `.github/workflows/`, pastikan tidak menimpa workflow lain yang sudah ada).
  - Pindahkan `github-pages-template/scripts/generate-index.js` ke `scripts/generate-index.js` di root repositori.
  - Buat folder `docs/reports/` dan tambahkan file `docs/reports/.gitkeep` (pertahankan file dokumentasi lama yang sudah ada di dalam `docs/` tanpa menghapusnya).
  - Hapus folder `github-pages-template/` setelah seluruh isinya dipindahkan.
- [x] **Task 8 (Update Generator & Workflow Paths):**
  - Perbarui `scripts/generate-index.js` agar memindai seluruh file `.html` di direktori `../docs/reports` dan menulis output halaman indeks ke `../docs/index.html` (pastikan URL tautan relatif pada tabel di `docs/index.html` tetap mengarah ke `reports/<nama-file>.html`).
  - Perbarui `.github/workflows/build-index.yml` agar memicu workflow pada event `push` ke branch `main` dengan filter paths `docs/reports/**` dan `scripts/generate-index.js`, serta melakukan `git add docs/index.html`.
- [x] **Task 9 (Build & Verifikasi):**
  - Jalankan `node scripts/generate-index.js` secara lokal untuk memastikan `docs/index.html` berhasil ter-generate tanpa error.
  - Jalankan `npm run build` untuk memastikan ekstensi terkompilasi ulang dengan path upload terbaru.

## 1. Ringkasan Proyek & Tujuan
Memodifikasi ekstensi Chrome open-source **OpenJam** (`github.com/SaintPepsi/openjam`) agar memiliki fitur **Auto-Upload ke GitHub Repository** dan menghasilkan **tautan pratinjau publik berbasis GitHub Pages** secara otomatis setiap kali sesi perekaman diekspor, serta menyediakan skrip otomasi GitHub Actions untuk membangun halaman indeks (`index.html`) secara dinamis.

### Tujuan Utama:
1. Menghilangkan proses unduh-unggah manual file rekaman `.html` (hasil ekspor `rrweb` + network/console logs).
2. Menyediakan halaman pengaturan (**Chrome Extension Options**) berbasis `chrome.storage.local` agar kredensial GitHub (PAT, Owner, Repo, Branch, File Prefix) tidak di-*hardcode*.
3. Menyalin tautan publik GitHub Pages secara otomatis ke *clipboard* pengguna begitu proses unggah ke GitHub API selesai.
4. Menyediakan aset repositori target (`scripts/generate-index.js` dan `.github/workflows/build-index.yml`) untuk memperbarui halaman daftar rekaman (`index.html`) di GitHub Pages secara otomatis.

---

## 2. Arsitektur & Alur Kerja Sistem

```text
[Browser Tab] 
   │ (Rekam DOM rrweb, Network, Console, Audio)
   ▼
[OpenJam Extension] ──► Merakit Standalone HTML String
   │
   ├─► Baca konfigurasi dari `chrome.storage.local` ('openjam_github_config')
   ├─► Encode HTML string ke UTF-8 Base64
   ├─► HTTP PUT ke `[https://api.github.com/repos/](https://api.github.com/repos/){owner}/{repo}/contents/reports/{prefix}-{timestamp}.html`
   └─► Salin URL `https://{owner}.github.io/{repo}/reports/{prefix}-{timestamp}.html` ke Clipboard

[GitHub Repository]
   │ (Trigger event `push` pada path `reports/**`)
   ▼
[GitHub Actions Workflow] ──► Menjalankan `node scripts/generate-index.js`
   │
   └─► Auto-commit `index.html` terbaru ke branch `main` ──► Publikasi via GitHub Pages