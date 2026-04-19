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
        created_on: Utc::now().naive_utc(),
        modified_on: Utc::now().naive_utc(),
        user_id,
        currency: DEFAULT_CURRENCY.into(),
        title_type: Some(DEFAULT_TITLE_TYPE.into()),
        adult_content_level: 0,
        theme: Some(DEFAULT_THEME.into()),
        language: Some(DEFAULT_LANGUAGE.into()),
    }))
}

pub async fn update_user_settings(
    db: &Db,
    user_id: i32,
    req: &UpdateSettingsRequest,
) -> Result<SettingRow, AppError> {
    let now = Utc::now().naive_utc();

    let currency_code = req
        .currency
        .as_deref()
        .and_then(|c| get_currency_by_code(c))
        .map(|c| c.code)
        .unwrap_or_else(|| DEFAULT_CURRENCY.into());

    let title_type = req
        .title_type
        .as_deref()
        .unwrap_or(DEFAULT_TITLE_TYPE)
        .to_string();

    let adult_content_level = req.adult_content_level.unwrap_or(0);

    let theme = req
        .theme
        .as_deref()
        .filter(|t| VALID_THEMES.contains(t))
        .unwrap_or(DEFAULT_THEME)
        .to_string();

    let language = req
        .language
        .as_deref()
        .filter(|l| VALID_LANGUAGES.contains(l))
        .unwrap_or(DEFAULT_LANGUAGE)
        .to_string();

    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        user_id: Set(user_id),
        currency: Set(currency_code),
        title_type: Set(Some(title_type)),
        adult_content_level: Set(adult_content_level),
        theme: Set(Some(theme)),
        language: Set(Some(language)),
        ..Default::default()
    };

    let on_conflict = OnConflict::column(setting::Column::UserId)
        .update_columns([
            setting::Column::Currency,
            setting::Column::TitleType,
            setting::Column::AdultContentLevel,
            setting::Column::Theme,
            setting::Column::Language,
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
