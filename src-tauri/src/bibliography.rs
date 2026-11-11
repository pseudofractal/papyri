use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const LOOKUP_LIMIT: usize = 2 * 1024 * 1024;
const USER_AGENT: &str = "Papyri/0.1 bibliography lookup";

#[derive(Serialize)]
pub struct FetchedBibliography {
  pub kind: String,
  pub identifier: String,
  pub format: String,
  pub text: String,
  pub source: String,
}

#[derive(Deserialize)]
pub struct ReferenceResource {
  pub filename: String,
  pub kind: String,
  pub identifier: String,
  #[serde(default)]
  pub pmc: Option<String>,
}

#[derive(Serialize)]
pub struct SavedResource {
  pub path: String,
  pub format: String,
  pub source_url: String,
}

#[derive(Serialize)]
pub struct ResourceFailure {
  pub identifier: String,
  pub error: String,
}

#[derive(Serialize)]
pub struct DownloadedResources {
  pub directory: String,
  pub files: Vec<SavedResource>,
  pub failures: Vec<ResourceFailure>,
}

const DOWNLOAD_LIMIT: u64 = 100 * 1024 * 1024;
const PAGE_LIMIT: usize = 8 * 1024 * 1024;
const DOWNLOAD_USER_AGENT: &str =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Papyri/0.1";

fn safe_reference_stem(input: &str) -> String {
  let base = Path::new(input)
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("reference");
  let mut stem: String = base
    .chars()
    .map(|character| {
      if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
        character
      } else {
        '-'
      }
    })
    .collect();
  stem = stem
    .trim_matches(|character| character == '-' || character == '.')
    .trim()
    .to_string();
  if stem.is_empty() {
    stem = "reference".into();
  }
  let lower = stem.to_ascii_lowercase();
  for suffix in [".bib", ".pdf", ".html", ".htm", ".xml", ".json", ".txt"] {
    if lower.ends_with(suffix) && stem.len() > suffix.len() {
      stem.truncate(stem.len() - suffix.len());
      break;
    }
  }
  if stem.chars().count() > 100 {
    stem = stem.chars().take(100).collect();
  }
  if stem.is_empty() {
    "reference".into()
  } else {
    stem
  }
}

fn temp_path(directory: &Path, stem: &str) -> PathBuf {
  let stamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos();
  directory.join(format!(".{stem}-{stamp}.part"))
}

fn digest_bytes(bytes: &[u8]) -> Vec<u8> {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  hasher.finalize().to_vec()
}

fn digest_file(path: &Path) -> Result<Vec<u8>, String> {
  let mut file =
    fs::File::open(path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 64 * 1024];
  loop {
    let read = file
      .read(&mut buffer)
      .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    if read == 0 {
      break;
    }
    hasher.update(&buffer[..read]);
  }
  Ok(hasher.finalize().to_vec())
}

fn publish_bytes(
  directory: &Path,
  stem: &str,
  extension: &str,
  bytes: &[u8],
) -> Result<PathBuf, String> {
  let digest = digest_bytes(bytes);
  for index in 0..1_000 {
    let name = if index == 0 {
      format!("{stem}.{extension}")
    } else {
      format!("{stem}-{}.{extension}", index + 1)
    };
    let candidate = directory.join(name);
    if candidate.exists() {
      if digest_file(&candidate).ok().as_deref() == Some(digest.as_slice()) {
        return Ok(candidate);
      }
      continue;
    }
    fs::write(&candidate, bytes)
      .map_err(|error| format!("Could not write {}: {error}", candidate.display()))?;
    return Ok(candidate);
  }
  Err("Could not choose a unique filename for the download.".into())
}

fn publish_temp(
  temp: &Path,
  directory: &Path,
  stem: &str,
  extension: &str,
) -> Result<PathBuf, String> {
  let digest = digest_file(temp)?;
  for index in 0..1_000 {
    let name = if index == 0 {
      format!("{stem}.{extension}")
    } else {
      format!("{stem}-{}.{extension}", index + 1)
    };
    let candidate = directory.join(name);
    if candidate.exists() {
      if digest_file(&candidate).ok().as_deref() == Some(digest.as_slice()) {
        fs::remove_file(temp).ok();
        return Ok(candidate);
      }
      continue;
    }
    fs::rename(temp, &candidate)
      .map_err(|error| format!("Could not write {}: {error}", candidate.display()))?;
    return Ok(candidate);
  }
  fs::remove_file(temp).ok();
  Err("Could not choose a unique filename for the download.".into())
}

fn extension_for_content_type(content_type: &str) -> &'static str {
  if content_type.contains("pdf") {
    "pdf"
  } else if content_type.contains("html") || content_type.contains("xhtml") {
    "html"
  } else if content_type.contains("xml") {
    "xml"
  } else if content_type.contains("json") {
    "json"
  } else if content_type.contains("text/") {
    "txt"
  } else {
    "bin"
  }
}

fn content_type(response: &reqwest::blocking::Response) -> String {
  response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .unwrap_or("")
    .to_ascii_lowercase()
}

fn read_body_limited(
  response: reqwest::blocking::Response,
  limit: usize,
) -> Result<Vec<u8>, String> {
  let status = response.status();
  if !status.is_success() {
    return Err(match status.as_u16() {
      404 => "Page not found.".to_string(),
      429 => "The site is rate-limiting requests.".to_string(),
      _ => format!("The site returned HTTP {status}."),
    });
  }
  let mut reader = response.take(limit as u64 + 1);
  let mut bytes = Vec::new();
  reader
    .read_to_end(&mut bytes)
    .map_err(|error| format!("Could not read the response: {error}"))?;
  if bytes.len() > limit {
    return Err("The response is too large.".into());
  }
  Ok(bytes)
}

fn save_pdf_response(
  response: reqwest::blocking::Response,
  directory: &Path,
  stem: &str,
  source_url: &str,
  content_type: &str,
) -> Result<SavedResource, String> {
  let temp = temp_path(directory, stem);
  let mut file = fs::File::create(&temp)
    .map_err(|error| format!("Could not create {}: {error}", temp.display()))?;
  let mut reader = response;
  let mut prefix = [0u8; 5];
  let read = reader
    .read(&mut prefix)
    .map_err(|error| format!("Could not read the PDF: {error}"))?;
  let is_pdf = read == 5 && &prefix[..5] == b"%PDF-";
  if !is_pdf && !content_type.contains("pdf") {
    drop(file);
    fs::remove_file(&temp).ok();
    return Err("The site did not return a PDF.".into());
  }
  let result = (|| -> Result<(), String> {
    file
      .write_all(&prefix[..read])
      .map_err(|error| format!("Could not write the PDF: {error}"))?;
    let mut limited = reader.take(DOWNLOAD_LIMIT - read as u64 + 1);
    let copied = std::io::copy(&mut limited, &mut file)
      .map_err(|error| format!("Could not write the PDF: {error}"))?;
    if read as u64 + copied > DOWNLOAD_LIMIT {
      return Err("The PDF is too large.".into());
    }
    file
      .flush()
      .map_err(|error| format!("Could not write the PDF: {error}"))?;
    Ok(())
  })();
  if let Err(error) = result {
    drop(file);
    fs::remove_file(&temp).ok();
    return Err(error);
  }
  drop(file);
  let path = publish_temp(&temp, directory, stem, "pdf")?;
  Ok(SavedResource {
    path: path.display().to_string(),
    format: "pdf".into(),
    source_url: source_url.to_string(),
  })
}

fn download_pdf(
  client: &reqwest::blocking::Client,
  url: &str,
  directory: &Path,
  stem: &str,
) -> Result<SavedResource, String> {
  let response = client
    .get(url)
    .header(reqwest::header::ACCEPT, "application/pdf,*/*;q=0.8")
    .send()
    .map_err(|error| format!("Could not reach {url}: {error}"))?;
  let status = response.status();
  if !status.is_success() {
    return Err(match status.as_u16() {
      404 => "The PDF is not available at that address.".to_string(),
      429 => "The site is rate-limiting requests.".to_string(),
      _ => format!("The site returned HTTP {status} for the PDF."),
    });
  }
  let final_url = response.url().to_string();
  let content_type = content_type(&response);
  save_pdf_response(response, directory, stem, &final_url, &content_type)
}

enum Page {
  Saved(SavedResource),
  Html { html: String, url: String },
}

fn looks_like_html(bytes: &[u8]) -> bool {
  let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_ascii_lowercase();
  prefix.contains("<!doctype html") || prefix.contains("<html") || prefix.contains("<head")
}

fn fetch_page(
  client: &reqwest::blocking::Client,
  url: &str,
  directory: &Path,
  stem: &str,
) -> Result<Page, String> {
  let response = client
    .get(url)
    .header(
      reqwest::header::ACCEPT,
      "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    )
    .send()
    .map_err(|error| format!("Could not reach {url}: {error}"))?;
  let status = response.status();
  if !status.is_success() {
    return Err(match status.as_u16() {
      404 => "The page was not found.".to_string(),
      429 => "The site is rate-limiting requests.".to_string(),
      _ => format!("The site returned HTTP {status}."),
    });
  }
  let final_url = response.url().to_string();
  let content_type = content_type(&response);
  if content_type.contains("pdf") {
    return save_pdf_response(response, directory, stem, &final_url, &content_type)
      .map(Page::Saved);
  }
  let bytes = read_body_limited(response, PAGE_LIMIT)?;
  if bytes.starts_with(b"%PDF-") {
    let path = publish_bytes(directory, stem, "pdf", &bytes)?;
    return Ok(Page::Saved(SavedResource {
      path: path.display().to_string(),
      format: "pdf".into(),
      source_url: final_url,
    }));
  }
  if content_type.contains("html") || content_type.contains("xhtml") || looks_like_html(&bytes) {
    return Ok(Page::Html {
      html: String::from_utf8_lossy(&bytes).to_string(),
      url: final_url,
    });
  }
  let extension = extension_for_content_type(&content_type);
  let path = publish_bytes(directory, stem, extension, &bytes)?;
  Ok(Page::Saved(SavedResource {
    path: path.display().to_string(),
    format: extension.into(),
    source_url: final_url,
  }))
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
  let lower = tag.to_ascii_lowercase();
  let position = lower.find(&format!("{name}="))?;
  let rest = tag[position + name.len() + 1..].trim_start();
  let quote = rest.chars().next()?;
  if quote == '"' || quote == '\'' {
    let end = rest[1..].find(quote)?;
    Some(rest[1..1 + end].replace("&amp;", "&"))
  } else {
    let end = rest
      .find(|character: char| character.is_whitespace() || character == '>')
      .unwrap_or(rest.len());
    Some(rest[..end].replace("&amp;", "&"))
  }
}

fn meta_content(html: &str, name: &str) -> Option<String> {
  let lower = html.to_ascii_lowercase();
  let mut search = 0;
  while let Some(offset) = lower[search..].find(name) {
    let position = search + offset;
    let start = lower[..position].rfind("<meta").unwrap_or(position);
    let end = lower[position..]
      .find('>')
      .map(|offset| position + offset)
      .unwrap_or(lower.len());
    let tag = &html[start..end];
    if let Some(content) = attr_value(tag, "content") {
      return Some(content);
    }
    search = position + name.len();
  }
  None
}

fn citation_pdf_url(html: &str, base_url: &str) -> Option<String> {
  let content = meta_content(html, "citation_pdf_url")?;
  let base = reqwest::Url::parse(base_url).ok()?;
  base.join(&content).ok().map(|url| url.to_string())
}

fn openalex_pdf_url(
  client: &reqwest::blocking::Client,
  doi: &str,
) -> Result<Option<String>, String> {
  let url = format!("https://api.openalex.org/works/https://doi.org/{doi}");
  let response = client
    .get(&url)
    .header(reqwest::header::ACCEPT, "application/json")
    .send()
    .map_err(|error| format!("Could not query OpenAlex: {error}"))?;
  if !response.status().is_success() {
    return Ok(None);
  }
  let text = read_limited(response)?;
  let value: serde_json::Value =
    serde_json::from_str(&text).map_err(|_| "Invalid OpenAlex response.")?;
  for pointer in ["/best_oa_location/pdf_url", "/primary_location/pdf_url"] {
    if let Some(url) = value.pointer(pointer).and_then(|value| value.as_str()) {
      if !url.is_empty() {
        return Ok(Some(url.to_string()));
      }
    }
  }
  Ok(None)
}

fn download_doi(
  client: &reqwest::blocking::Client,
  doi: &str,
  directory: &Path,
  stem: &str,
) -> Result<SavedResource, String> {
  if let Ok(Some(pdf_url)) = openalex_pdf_url(client, doi) {
    if let Ok(saved) = download_pdf(client, &pdf_url, directory, stem) {
      return Ok(saved);
    }
  }
  let doi_url = format!("https://doi.org/{doi}");
  match fetch_page(client, &doi_url, directory, stem)? {
    Page::Saved(saved) => Ok(saved),
    Page::Html { html, url } => {
      if let Some(pdf_url) = citation_pdf_url(&html, &url) {
        if let Ok(saved) = download_pdf(client, &pdf_url, directory, stem) {
          return Ok(saved);
        }
      }
      let path = publish_bytes(directory, stem, "html", html.as_bytes())?;
      Ok(SavedResource {
        path: path.display().to_string(),
        format: "html".into(),
        source_url: url,
      })
    }
  }
}

fn download_arxiv(
  client: &reqwest::blocking::Client,
  id: &str,
  directory: &Path,
  stem: &str,
) -> Result<SavedResource, String> {
  let pdf_url = format!("https://arxiv.org/pdf/{id}");
  if let Ok(saved) = download_pdf(client, &pdf_url, directory, stem) {
    return Ok(saved);
  }
  let abs_url = format!("https://arxiv.org/abs/{id}");
  match fetch_page(client, &abs_url, directory, stem)? {
    Page::Saved(saved) => Ok(saved),
    Page::Html { html, url } => {
      let path = publish_bytes(directory, stem, "html", html.as_bytes())?;
      Ok(SavedResource {
        path: path.display().to_string(),
        format: "html".into(),
        source_url: url,
      })
    }
  }
}

fn download_pmid(
  client: &reqwest::blocking::Client,
  pmid: &str,
  pmc: Option<&str>,
  directory: &Path,
  stem: &str,
) -> Result<SavedResource, String> {
  if let Some(pmc) = pmc.map(str::trim).filter(|value| !value.is_empty()) {
    let pmc = pmc.trim_start_matches("PMC");
    let pdf_url = format!("https://pmc.ncbi.nlm.nih.gov/articles/PMC{pmc}/pdf/");
    if let Ok(saved) = download_pdf(client, &pdf_url, directory, stem) {
      return Ok(saved);
    }
  }
  let pubmed_url = format!("https://pubmed.ncbi.nlm.nih.gov/{pmid}/");
  match fetch_page(client, &pubmed_url, directory, stem)? {
    Page::Saved(saved) => Ok(saved),
    Page::Html { html, url } => {
      let path = publish_bytes(directory, stem, "html", html.as_bytes())?;
      Ok(SavedResource {
        path: path.display().to_string(),
        format: "html".into(),
        source_url: url,
      })
    }
  }
}

fn download_resource(
  client: &reqwest::blocking::Client,
  resource: &ReferenceResource,
  directory: &Path,
) -> Result<SavedResource, String> {
  let stem = safe_reference_stem(&resource.filename);
  match resource.kind.to_ascii_lowercase().as_str() {
    "doi" => download_doi(client, &resource.identifier, directory, &stem),
    "arxiv" => download_arxiv(client, &resource.identifier, directory, &stem),
    "pmid" => download_pmid(
      client,
      &resource.identifier,
      resource.pmc.as_deref(),
      directory,
      &stem,
    ),
    other => Err(format!("Unsupported reference source `{other}`.")),
  }
}

/// Download PDFs or landing-page HTML for fetched references into `<cwd>/references`.
pub fn download_resources(
  resources: Vec<ReferenceResource>,
) -> Result<DownloadedResources, String> {
  let directory = std::env::current_dir()
    .map_err(|error| format!("Could not determine the current working directory: {error}"))?
    .join("references");
  fs::create_dir_all(&directory)
    .map_err(|error| format!("Could not create {}: {error}", directory.display()))?;
  let client = reqwest::blocking::Client::builder()
    .user_agent(DOWNLOAD_USER_AGENT)
    .connect_timeout(Duration::from_secs(15))
    .timeout(Duration::from_secs(120))
    .redirect(reqwest::redirect::Policy::limited(10))
    .build()
    .map_err(|error| format!("Could not initialize the download client: {error}"))?;
  let mut files = Vec::new();
  let mut failures = Vec::new();
  for resource in resources {
    match download_resource(&client, &resource, &directory) {
      Ok(saved) => files.push(saved),
      Err(error) => failures.push(ResourceFailure {
        identifier: resource.identifier,
        error,
      }),
    }
  }
  Ok(DownloadedResources {
    directory: directory.display().to_string(),
    files,
    failures,
  })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IdentifierKind {
  Doi,
  Arxiv,
  Pmid,
}

#[derive(Debug)]
struct Identifier {
  kind: IdentifierKind,
  value: String,
}

fn strip_prefix_ci<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
  value
    .get(..prefix.len())
    .filter(|head| head.eq_ignore_ascii_case(prefix))
    .map(|_| &value[prefix.len()..])
}

fn trim_lookup_value(value: &str) -> &str {
  value.trim_matches(|character: char| {
    character.is_whitespace() || matches!(character, '.' | ',' | ';')
  })
}

fn strip_arxiv_version(value: &str) -> &str {
  if let Some(index) = value.rfind('v') {
    if index + 1 < value.len()
      && value[index + 1..]
        .chars()
        .all(|character| character.is_ascii_digit())
    {
      return &value[..index];
    }
  }
  value
}

fn is_doi(value: &str) -> bool {
  let Some(rest) = value.strip_prefix("10.") else {
    return false;
  };
  let Some(slash) = rest.find('/') else {
    return false;
  };
  let registrant = &rest[..slash];
  !registrant.is_empty()
    && registrant.len() <= 9
    && registrant
      .chars()
      .all(|character| character.is_ascii_digit())
    && rest.len() > slash + 1
}

fn is_arxiv(value: &str) -> bool {
  let value = strip_arxiv_version(value);
  if let Some((prefix, suffix)) = value.split_once('.') {
    if prefix.len() == 4
      && prefix.chars().all(|character| character.is_ascii_digit())
      && (suffix.len() == 4 || suffix.len() == 5)
      && suffix.chars().all(|character| character.is_ascii_digit())
    {
      return true;
    }
  }
  let Some((archive, number)) = value.split_once('/') else {
    return false;
  };
  !archive.is_empty()
    && !archive.starts_with("10.")
    && archive
      .chars()
      .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '.'))
    && number.len() == 7
    && number.chars().all(|character| character.is_ascii_digit())
}

fn classify_identifier(input: &str) -> Result<Identifier, String> {
  let value = trim_lookup_value(input);
  if value.is_empty() {
    return Err("Enter a DOI, arXiv ID, or PubMed ID.".into());
  }
  for prefix in [
    "https://doi.org/",
    "http://doi.org/",
    "https://dx.doi.org/",
    "http://dx.doi.org/",
    "doi:",
    "doi ",
  ] {
    if let Some(rest) = strip_prefix_ci(value, prefix) {
      let doi = trim_lookup_value(rest);
      return if is_doi(doi) {
        Ok(Identifier {
          kind: IdentifierKind::Doi,
          value: doi.to_string(),
        })
      } else {
        Err(format!("`{doi}` does not look like a valid DOI."))
      };
    }
  }
  for prefix in [
    "https://arxiv.org/abs/",
    "http://arxiv.org/abs/",
    "https://arxiv.org/pdf/",
    "http://arxiv.org/pdf/",
    "arxiv:",
    "arxiv ",
  ] {
    if let Some(rest) = strip_prefix_ci(value, prefix) {
      let id = rest
        .split(['?', '#'])
        .next()
        .unwrap_or(rest)
        .trim_end_matches(".pdf");
      let id = strip_arxiv_version(id);
      return if is_arxiv(id) {
        Ok(Identifier {
          kind: IdentifierKind::Arxiv,
          value: id.to_string(),
        })
      } else {
        Err(format!("`{id}` does not look like a valid arXiv ID."))
      };
    }
  }
  for prefix in [
    "https://pubmed.ncbi.nlm.nih.gov/",
    "http://pubmed.ncbi.nlm.nih.gov/",
    "pmid:",
    "pmid ",
  ] {
    if let Some(rest) = strip_prefix_ci(value, prefix) {
      let pmid = rest.split(['?', '#', '/']).next().unwrap_or(rest).trim();
      return if !pmid.is_empty() && pmid.chars().all(|character| character.is_ascii_digit()) {
        Ok(Identifier {
          kind: IdentifierKind::Pmid,
          value: pmid.to_string(),
        })
      } else {
        Err(format!("`{pmid}` does not look like a valid PubMed ID."))
      };
    }
  }
  if is_doi(value) {
    return Ok(Identifier {
      kind: IdentifierKind::Doi,
      value: value.to_string(),
    });
  }
  if is_arxiv(value) {
    return Ok(Identifier {
      kind: IdentifierKind::Arxiv,
      value: strip_arxiv_version(value).to_string(),
    });
  }
  if (6..=9).contains(&value.len()) && value.chars().all(|character| character.is_ascii_digit()) {
    return Ok(Identifier {
      kind: IdentifierKind::Pmid,
      value: value.to_string(),
    });
  }
  Err("Unsupported identifier. Enter a DOI (10.…), arXiv ID (2401.…), or PubMed ID.".into())
}

fn client() -> Result<reqwest::blocking::Client, String> {
  reqwest::blocking::Client::builder()
    .user_agent(USER_AGENT)
    .https_only(true)
    .connect_timeout(Duration::from_secs(10))
    .timeout(Duration::from_secs(25))
    .redirect(reqwest::redirect::Policy::limited(10))
    .build()
    .map_err(|error| format!("Could not initialize the lookup client: {error}"))
}

fn read_limited(response: reqwest::blocking::Response) -> Result<String, String> {
  let status = response.status();
  if !status.is_success() {
    return Err(match status.as_u16() {
      404 => "The identifier was not found.".to_string(),
      429 => "The lookup service is rate-limiting requests. Try again shortly.".to_string(),
      _ => format!("The lookup service returned HTTP {status}."),
    });
  }
  let mut reader = response.take(LOOKUP_LIMIT as u64 + 1);
  let mut bytes = Vec::new();
  reader
    .read_to_end(&mut bytes)
    .map_err(|error| format!("Could not read the lookup response: {error}"))?;
  if bytes.len() > LOOKUP_LIMIT {
    return Err("The lookup response is too large.".into());
  }
  String::from_utf8(bytes).map_err(|_| "The lookup response was not valid UTF-8.".into())
}

fn fetch_doi(client: &reqwest::blocking::Client, doi: &str) -> Result<FetchedBibliography, String> {
  let url = format!("https://doi.org/{doi}");
  let response = client
    .get(&url)
    .header(reqwest::header::ACCEPT, "application/x-bibtex")
    .send()
    .map_err(|error| format!("Could not reach the DOI resolver: {error}"))?;
  let text = read_limited(response)?;
  if !text.trim_start().starts_with('@') {
    return Err("The DOI resolver did not return BibTeX for this DOI.".into());
  }
  Ok(FetchedBibliography {
    kind: "doi".into(),
    identifier: doi.to_string(),
    format: "bibtex".into(),
    text,
    source: url,
  })
}

fn fetch_arxiv(
  client: &reqwest::blocking::Client,
  id: &str,
) -> Result<FetchedBibliography, String> {
  let url = format!("https://arxiv.org/bibtex/{id}");
  let response = client
    .get(&url)
    .send()
    .map_err(|error| format!("Could not reach arXiv: {error}"))?;
  let text = read_limited(response)?;
  if !text.trim_start().starts_with('@') {
    return Err("arXiv did not return a BibTeX record for this ID.".into());
  }
  Ok(FetchedBibliography {
    kind: "arxiv".into(),
    identifier: id.to_string(),
    format: "bibtex".into(),
    text,
    source: url,
  })
}

fn fetch_pmid(
  client: &reqwest::blocking::Client,
  pmid: &str,
) -> Result<FetchedBibliography, String> {
  let url = format!(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id={pmid}&rettype=medline&retmode=text&tool=papyri"
  );
  let response = client
    .get(&url)
    .send()
    .map_err(|error| format!("Could not reach PubMed: {error}"))?;
  let text = read_limited(response)?;
  if !text.contains("PMID-") {
    return Err("PubMed did not return a MEDLINE record for this ID.".into());
  }
  Ok(FetchedBibliography {
    kind: "pmid".into(),
    identifier: pmid.to_string(),
    format: "nbib".into(),
    text,
    source: url,
  })
}

pub fn fetch(input: &str) -> Result<FetchedBibliography, String> {
  let identifier = classify_identifier(input)?;
  let client = client()?;
  match identifier.kind {
    IdentifierKind::Doi => fetch_doi(&client, &identifier.value),
    IdentifierKind::Arxiv => fetch_arxiv(&client, &identifier.value),
    IdentifierKind::Pmid => fetch_pmid(&client, &identifier.value),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn classified(input: &str) -> (IdentifierKind, String) {
    let identifier = classify_identifier(input).expect("identifier should classify");
    (identifier.kind, identifier.value)
  }

  #[test]
  fn classifies_dois_and_doi_urls() {
    assert_eq!(
      classified("10.1038/nature12373."),
      (IdentifierKind::Doi, "10.1038/nature12373".into())
    );
    assert_eq!(
      classified("doi:10.1145/3290605.3300233"),
      (IdentifierKind::Doi, "10.1145/3290605.3300233".into())
    );
    assert_eq!(
      classified("https://doi.org/10.1007/978-3-319-24574-4_77"),
      (IdentifierKind::Doi, "10.1007/978-3-319-24574-4_77".into())
    );
  }

  #[test]
  fn classifies_arxiv_ids_and_urls() {
    assert_eq!(
      classified("arXiv:2401.00001v2"),
      (IdentifierKind::Arxiv, "2401.00001".into())
    );
    assert_eq!(
      classified("https://arxiv.org/abs/2401.00001"),
      (IdentifierKind::Arxiv, "2401.00001".into())
    );
    assert_eq!(
      classified("https://arxiv.org/pdf/hep-th/9711200.pdf"),
      (IdentifierKind::Arxiv, "hep-th/9711200".into())
    );
    assert_eq!(
      classified("hep-th/9711200v3"),
      (IdentifierKind::Arxiv, "hep-th/9711200".into())
    );
  }

  #[test]
  fn classifies_pmid_ids_and_urls() {
    assert_eq!(
      classified("PMID: 31452104"),
      (IdentifierKind::Pmid, "31452104".into())
    );
    assert_eq!(
      classified("https://pubmed.ncbi.nlm.nih.gov/31452104/"),
      (IdentifierKind::Pmid, "31452104".into())
    );
    assert_eq!(
      classified("31452104"),
      (IdentifierKind::Pmid, "31452104".into())
    );
  }

  #[test]
  fn rejects_unknown_identifiers() {
    assert!(classify_identifier("").is_err());
    assert!(classify_identifier("not an identifier").is_err());
    assert!(classify_identifier("10.1234").is_err());
    assert!(classify_identifier("2401.1").is_err());
  }

  #[test]
  fn sanitizes_reference_stems() {
    assert_eq!(safe_reference_stem("Kucsko_2013.bib"), "Kucsko_2013");
    assert_eq!(safe_reference_stem("../../evil.bib"), "evil");
    assert_eq!(safe_reference_stem("a/b"), "b");
    assert_eq!(safe_reference_stem(""), "reference");
    assert_eq!(safe_reference_stem("..."), "reference");
    assert_eq!(safe_reference_stem("Müller 2019"), "Müller-2019");
  }

  #[test]
  fn publishes_bytes_without_overwriting_different_content() {
    use std::time::{SystemTime, UNIX_EPOCH};
    let stamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("clock should be after the epoch")
      .as_nanos();
    let directory = std::env::temp_dir().join(format!(
      "papyri-reference-save-{}-{stamp}",
      std::process::id()
    ));
    fs::create_dir_all(&directory).expect("directory should be created");
    let first = publish_bytes(&directory, "Kucsko_2013", "pdf", b"%PDF-first")
      .expect("first publish should succeed");
    assert!(first.ends_with("Kucsko_2013.pdf"));
    let repeated = publish_bytes(&directory, "Kucsko_2013", "pdf", b"%PDF-first")
      .expect("identical publish should succeed");
    assert_eq!(repeated, first);
    let different = publish_bytes(&directory, "Kucsko_2013", "pdf", b"%PDF-second")
      .expect("different publish should succeed");
    assert!(different.ends_with("Kucsko_2013-2.pdf"));
    assert_eq!(
      fs::read_dir(&directory)
        .expect("directory should be readable")
        .count(),
      2
    );
    fs::remove_dir_all(&directory).ok();
  }

  #[test]
  fn extracts_citation_pdf_url_from_meta_tags() {
    let html = r#"<html><head><meta name="citation_pdf_url" content="https://example.org/paper.pdf"></head></html>"#;
    assert_eq!(
      citation_pdf_url(html, "https://example.org/article"),
      Some("https://example.org/paper.pdf".into())
    );
    let relative = r#"<meta content="/files/paper.pdf" name="citation_pdf_url">"#;
    assert_eq!(
      citation_pdf_url(relative, "https://example.org/article"),
      Some("https://example.org/files/paper.pdf".into())
    );
  }
}
