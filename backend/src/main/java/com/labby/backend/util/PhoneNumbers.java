package com.labby.backend.util;

/**
 * The one phone canonicalizer (USR-01 "one account per phone", AUTH-01; owner ruling 2026-10-20):
 * every phone is stored and looked up as E.164 {@code +<country><number>}, with Syria as the
 * default country for numbers typed the local way. Every phone input — register, login, password
 * reset, phone change, admin creation, admin search — goes through {@link #normalize} before it
 * touches the database, so {@code 0933000111}, {@code +963933000111} and {@code 963933000111} are
 * one identity. Migration V35 applies the same rules to the stored rows.
 *
 * <p>Rules, after stripping spaces and dashes:
 *
 * <ul>
 *   <li>{@code +…} is kept as typed;
 *   <li>{@code 00…} (international dialling prefix) becomes {@code +…};
 *   <li>{@code 0…} (Syrian local form, e.g. {@code 09xxxxxxxx}) becomes {@code +963…} without the
 *       leading zero;
 *   <li>{@code 963…} (the Syrian code without the plus) becomes {@code +963…}.
 * </ul>
 *
 * Any other form (a bare foreign number without {@code +}) is left as typed and fails {@link
 * #E164}: other countries must be typed with {@code +} and their code.
 */
public final class PhoneNumbers {

  /** A canonical phone: {@code +}, a non-zero country digit, 8–15 digits in all (E.164). */
  public static final String E164 = "^\\+[1-9][0-9]{7,14}$";

  /** The validation message of a phone that is not E.164 after {@link #normalize}. */
  public static final String INVALID = "invalid phone number";

  /** Syria's country code — the default for local numbers. */
  public static final String DEFAULT_COUNTRY_CODE = "963";

  private PhoneNumbers() {}

  /**
   * Canonicalizes a typed phone number (see the class rules).
   *
   * @param raw the number as typed, may be null
   * @return the E.164 form, or the stripped input when no rule applies (then it fails {@link
   *     #E164}); null for null
   */
  public static String normalize(String raw) {
    if (raw == null) {
      return null;
    }
    String phone = raw.replaceAll("[\\s\\-]", "");
    if (phone.startsWith("+")) {
      return phone;
    }
    if (phone.startsWith("00")) {
      return "+" + phone.substring(2);
    }
    if (phone.startsWith("0")) {
      return "+" + DEFAULT_COUNTRY_CODE + phone.substring(1);
    }
    if (phone.startsWith(DEFAULT_COUNTRY_CODE)) {
      return "+" + phone;
    }
    return phone;
  }
}
