use chrono::Utc;
use sea_orm::{sea_query::OnConflict, ColumnTrait, EntityTrait, QueryFilter, Set};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::setting::{self, ActiveModel, CurrencyInfo, Entity as SettingEntity, SettingRow, UpdateSettingsRequest};

const DEFAULT_TITLE_TYPE: &str = "Default";
const DEFAULT_CURRENCY: &str = "USD";
const DEFAULT_THEME: &str = "dark";
const VALID_THEMES: &[&str] = &["dark", "light", "auto"];
const DEFAULT_LANGUAGE: &str = "en";
const VALID_LANGUAGES: &[&str] = &["en", "fr", "es"];

/// 朱 · Curated accent palette names. Mirror this list in
/// `client/src/lib/accent.js` and the CHECK constraint in the
/// migration — three places to keep in sync, but the alternative
/// (free-form colour input) loses contrast guarantees.
const VALID_ACCENT_COLORS: &[&str] =
    &["shu", "kin", "moegi", "sakura", "ai", "kuro", "murasaki", "akane"];

pub fn get_currency_by_code(code: &str) -> Option<CurrencyInfo> {
    match code {
        "USD" => Some(CurrencyInfo {
            code: "USD".into(),
            symbol: "$".into(),
            separator: ".".into(),
            decimal: ",".into(),
            precision: 2,
            format: "!#".into(),
            negative_pattern: "-!#".into(),
        }),
        "EUR" => Some(CurrencyInfo {
            code: "EUR".into(),
            symbol: "€".into(),
            separator: " ".into(),
            decimal: ",".into(),
            precision: 2,
            format: "#!".into(),
            negative_pattern: "-#!".into(),
        }),
        _ => None,
    }
}

pub async fn get_user_settings(db: &Db, user_id: i32) -> Result<SettingRow, AppError> {
    let row = SettingEntity::find()
        .filter(setting::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?;

    // If no settings row yet, return defaults (no DB row needed until first update)
    Ok(row.unwrap_or_else(|| SettingRow {
        id: 0,
        created_on: Utc::now(),
        modified_on: Utc::now(),
        user_id,
        currency: DEFAULT_CURRENCY.into(),
        title_type: Some(DEFAULT_TITLE_TYPE.into()),
        adult_content_level: 0,
        theme: Some(DEFAULT_THEME.into()),
        language: Some(DEFAULT_LANGUAGE.into()),
        avatar_url: None,
        sound_enabled: false,
        accent_color: None,
        shelf_3d_enabled: false,
        ink_trail_enabled: false,
    }))
}

pub async fn update_user_settings(
    db: &Db,
    user_id: i32,
    req: &UpdateSettingsRequest,
) -> Result<SettingRow, AppError> {
    let now = Utc::now();

    // PARTIAL UPDATE SEMANTICS
    //
    // Every field in `UpdateSettingsRequest` is `Option<T>`. A `None`
    // means "caller didn't touch this field — preserve what's there".
    // The previous implementation hydrated every absent field with its
    // default (USD, "Default", "dark", "en"…) and then wrote that back
    // to the DB via an upsert with `update_columns` listing every
    // column, silently clobbering whatever the user had set. A PATCH
    // carrying only `{"theme": "light"}` would therefore reset
    // currency → USD, title_type → Default, language → en, etc.
    //
    // The fix is to read the existing row (or synthesise defaults when
    // there is none) and merge field-by-field: `req.x OR existing.x`.
    // The upsert below then writes the merged state, which is
    // idempotent for absent fields (they get re-written to the same
    // value) but no longer destructive.
    let existing = get_user_settings(db, user_id).await?;

    // Validation layer — applied AFTER the merge so a malformed
    // `theme: "rainbow"` in the request falls back to the existing
    // theme (not the hard-coded default), which is the least
    // surprising behaviour.
    let currency_code = req
        .currency
        .as_deref()
        .and_then(get_currency_by_code)
        .map(|c| c.code)
        .unwrap_or(existing.currency);

    let title_type = req
        .title_type
        .clone()
        .or(existing.title_type)
        .unwrap_or_else(|| DEFAULT_TITLE_TYPE.to_string());

    let adult_content_level = req.adult_content_level.unwrap_or(existing.adult_content_level);

    let theme = req
        .theme
        .as_deref()
        .filter(|t| VALID_THEMES.contains(t))
        .map(|s| s.to_string())
        .or(existing.theme)
        .unwrap_or_else(|| DEFAULT_THEME.to_string());

    let language = req
        .language
        .as_deref()
        .filter(|l| VALID_LANGUAGES.contains(l))
        .map(|s| s.to_string())
        .or(existing.language)
        .unwrap_or_else(|| DEFAULT_LANGUAGE.to_string());

    // Avatar URL — `None` in the request means "don't touch"; the
    // front-end signals "clear" via an explicit empty string, which
    // the handler translates to `Some("")` and we normalise to None
    // here (empty URL is never a valid value).
    let avatar_url = match req.avatar_url.as_deref() {
        Some("") => None,
        Some(u) => Some(u.to_string()),
        None => existing.avatar_url,
    };

    let sound_enabled = req.sound_enabled.unwrap_or(existing.sound_enabled);

    // Accent: `None` (absent) keeps existing; `Some("")` resets to
    // default (column NULL); `Some(name)` validates against the
    // curated set or falls back to existing on a typo. The CHECK
    // constraint catches anything that slips through.
    let accent_color = match req.accent_color.as_deref() {
        None => existing.accent_color,
        Some("") => None,
        Some(name) if VALID_ACCENT_COLORS.contains(&name) => Some(name.to_string()),
        Some(_) => existing.accent_color,
    };

    let shelf_3d_enabled = req.shelf_3d_enabled.unwrap_or(existing.shelf_3d_enabled);
    let ink_trail_enabled = req.ink_trail_enabled.unwrap_or(existing.ink_trail_enabled);

    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        user_id: Set(user_id),
        currency: Set(currency_code),
        title_type: Set(Some(title_type)),
        adult_content_level: Set(adult_content_level),
        theme: Set(Some(theme)),
        language: Set(Some(language)),
        avatar_url: Set(avatar_url),
        sound_enabled: Set(sound_enabled),
        accent_color: Set(accent_color),
        shelf_3d_enabled: Set(shelf_3d_enabled),
        ink_trail_enabled: Set(ink_trail_enabled),
        ..Default::default()
    };

    let on_conflict = OnConflict::column(setting::Column::UserId)
        .update_columns([
            setting::Column::Currency,
            setting::Column::TitleType,
            setting::Column::AdultContentLevel,
            setting::Column::Theme,
            setting::Column::Language,
            setting::Column::AvatarUrl,
            setting::Column::SoundEnabled,
            setting::Column::AccentColor,
            setting::Column::Shelf3dEnabled,
            setting::Column::InkTrailEnabled,
            setting::Column::ModifiedOn,
        ])
        .to_owned();

    let row = SettingEntity::insert(model)
        .on_conflict(on_conflict)
        .exec_with_returning(db)
        .await
        .map_err(AppError::from)?;

    Ok(row)
}
