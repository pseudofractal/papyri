fn main() {
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
    tauri_build::AppManifest::new().commands(&[
      "initial_path",
      "startup_trace",
      "list_directory",
      "read_document",
      "read_pdf",
      "read_asset",
      "document_stamp",
      "pick_path",
      "open_external",
    ]),
  ))
  .expect("Unable to generate application permissions");
}
