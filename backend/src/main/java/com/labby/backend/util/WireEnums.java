package com.labby.backend.util;

import com.labby.backend.exception.InvalidRequestException;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * Parses lowercase wire values of query parameters into the catalog enums (their {@code
 * fromValue}), answering 400 for an unknown value instead of Spring's name-based conversion.
 */
public final class WireEnums {

  private WireEnums() {}

  /**
   * One optional value.
   *
   * @param fromValue the enum's wire parser
   * @param value the raw parameter, or null / blank for none
   * @param name the parameter name (for the error message)
   * @param <E> the enum
   * @return the constant, or null when absent
   */
  public static <E extends Enum<E>> E parse(
      Function<String, E> fromValue, String value, String name) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return fromValue.apply(value.trim());
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("Unknown " + name + ": " + value);
    }
  }

  /**
   * A repeatable parameter.
   *
   * @param fromValue the enum's wire parser
   * @param values the raw values, or null
   * @param name the parameter name
   * @param <E> the enum
   * @return the constants (empty when absent)
   */
  public static <E extends Enum<E>> List<E> parseAll(
      Function<String, E> fromValue, List<String> values, String name) {
    List<E> parsed = new ArrayList<>();
    if (values != null) {
      for (String value : values) {
        E constant = parse(fromValue, value, name);
        if (constant != null) {
          parsed.add(constant);
        }
      }
    }
    return parsed;
  }
}
