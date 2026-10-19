package com.labby.backend.dto;

/**
 * A finished CSV export (analytics-v1 {@code Csv}): the attachment name and its UTF-8 bytes.
 *
 * @param filename {@code labby-<list>-<yyyyMMdd-HHmmss>Z.csv}
 * @param content the file, byte-order mark first
 * @param rows the data rows
 */
public record CsvFileDto(String filename, byte[] content, int rows) {}
