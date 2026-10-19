import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ApiError, isAccountSuspendedError } from "../../api/client";
import { getTripEarnings } from "../../api/money";
import type { TripEarning } from "../../api/money-types";
import { formatMoney } from "../../money/format";
import {
  createTicket,
  getTicketCategories,
  supportErrorCode,
  uploadTicketAttachment,
} from "../../api/support";
import type { TicketCategory } from "../../api/support-types";
import {
  TICKET_ATTACHMENTS_MAX,
  TICKET_DESCRIPTION_MAX,
} from "../../api/support-types";
import { pickFile } from "../../onboarding/file-picking";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { colors, radius, spacing } from "../../theme/tokens";
import { formatCount, formatDayMonthTime } from "../../trust/format";
import {
  AppText,
  Banner,
  FailureState,
  FieldError,
  FieldLabel,
  Icon,
  ListRow,
  LoadingState,
  PrimaryButton,
  Screen,
  TextButton,
  TextField,
  useDirection,
} from "../ui";

interface PickedAttachment {
  fileId: string;
  uri: string;
  name: string;
  isPdf: boolean;
}

type SendError =
  | "invalid"
  | "notFound"
  | "categoryUnavailable"
  | "network"
  | "server"
  | "accountSuspended";

function sendErrorOf(caught: unknown): SendError {
  if (isAccountSuspendedError(caught)) return "accountSuspended";
  if (!(caught instanceof ApiError)) return "network";
  if (caught.status === 400) return "invalid";
  if (caught.status === 404) return "notFound";
  if (caught.status === 409) {
    const code = supportErrorCode(caught);
    return code === "category_inactive" || code === "category_reserved"
      ? "categoryUnavailable"
      : "invalid";
  }
  return "server";
}

/** Upload failures → i18n keys (mirrors the report screen's mapping). */
function uploadErrorKey(error: unknown): string {
  if (isAccountSuspendedError(error)) return "trust.errors.accountSuspended";
  if (error instanceof ApiError) {
    if (error.status === 400) return "onboarding.file.rejected";
    if (error.status === 413) return "onboarding.file.tooLarge";
    if (error.status === 429) return "onboarding.file.dailyLimit";
    return "support.create.errors.server";
  }
  return "support.create.errors.network";
}

type RidePick =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "open"; trips: TripEarning[] }
  | { status: "error" };

/**
 * UC-S-19 (board S14TicketCreate): category (SUP-01), description ≤ 4000, up
 * to 5 attachments (JPEG/PNG/PDF via `POST /ticket-files`, each removable —
 * an unreferenced upload is simply dropped), an optional link to one of the
 * driver's recent trips, then `POST /tickets` → the new ticket's thread.
 */
export function TicketCreateScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { language, flipRows } = useDirection();
  const [categories, setCategories] = useState<
    | { status: "loading" }
    | { status: "loaded"; items: TicketCategory[] }
    | { status: "error"; kind: FailureKind }
  >({ status: "loading" });
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ridePick, setRidePick] = useState<RidePick>({ status: "closed" });
  const [ride, setRide] = useState<TripEarning | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchCategories = useCallback(async () => {
    setCategories({ status: "loading" });
    try {
      const items = await getTicketCategories();
      if (mounted.current) setCategories({ status: "loaded", items });
    } catch (caught) {
      if (mounted.current) {
        setCategories({ status: "error", kind: failureKindOf(caught) });
      }
    }
  }, []);

  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  const addAttachment = async () => {
    if (uploading || attachments.length >= TICKET_ATTACHMENTS_MAX) return;
    setUploadError(null);
    setUploading(true);
    try {
      // `document` = JPEG/PNG/PDF, exactly the contract's attachment types.
      const picked = await pickFile("document", "files");
      if (picked.status === "canceled") return;
      if (picked.status === "invalid") {
        setUploadError(picked.errorKey);
        return;
      }
      const uploaded = await uploadTicketAttachment(picked.file);
      setAttachments((list) =>
        list.length >= TICKET_ATTACHMENTS_MAX
          ? list
          : [
              ...list,
              {
                fileId: uploaded.fileId,
                uri: picked.file.uri,
                name: picked.file.name,
                isPdf: picked.file.mimeType === "application/pdf",
              },
            ],
      );
    } catch (caught) {
      setUploadError(uploadErrorKey(caught));
    } finally {
      setUploading(false);
    }
  };

  const openRidePick = async () => {
    setRidePick({ status: "loading" });
    try {
      const page = await getTripEarnings(0, 5);
      if (mounted.current) setRidePick({ status: "open", trips: page.items });
    } catch {
      if (mounted.current) setRidePick({ status: "error" });
    }
  };

  const send = async () => {
    if (!categoryId || sending || uploading || description.trim().length === 0) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const ticket = await createTicket({
        categoryId,
        description: description.trim(),
        rideId: ride?.rideId ?? null,
        attachmentFileIds: attachments.map((file) => file.fileId),
      });
      router.replace({
        pathname: "/ticket",
        params: { ticketId: ticket.ticketId },
      });
    } catch (caught) {
      setError(sendErrorOf(caught));
      setSending(false);
    }
  };

  const tripLine = (trip: TripEarning) =>
    t("support.create.tripOn", {
      date: formatDayMonthTime(trip.completedAt, language),
    });

  return (
    <Screen
      title={t("support.create.title")}
      testID="ticket-create-screen"
      keyboardShouldPersistTaps="handled"
      footer={
        <>
          <PrimaryButton
            title={t("support.create.send")}
            onPress={() => void send()}
            disabled={
              !categoryId || description.trim().length === 0 || uploading
            }
            busy={sending}
            testID="ticket-create-send"
          />
          <AppText
            variant="caption"
            weight="400"
            color={colors.textSecondary}
            style={styles.center}
          >
            {t("support.create.footnote")}
          </AppText>
        </>
      }
    >
      <View style={styles.group}>
        <FieldLabel>{t("support.create.categoryLabel")}</FieldLabel>
        {categories.status === "loading" ? (
          <LoadingState testID="ticket-categories-loading" />
        ) : null}
        {categories.status === "error" ? (
          <FailureState
            kind={categories.kind}
            onRetry={() => void fetchCategories()}
            testID="ticket-categories-error"
          />
        ) : null}
        {categories.status === "loaded" ? (
          <View accessibilityRole="radiogroup" style={styles.group}>
            {categories.items.map((category) => {
              const selected = categoryId === category.ticketCategoryId;
              return (
                <Pressable
                  key={category.ticketCategoryId}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => {
                    if (sending) return;
                    setCategoryId(category.ticketCategoryId);
                    setError(null);
                  }}
                  style={[
                    styles.option,
                    selected && styles.optionSelected,
                    flipRows && styles.rowReverse,
                  ]}
                  testID={`ticket-category-${category.ticketCategoryId}`}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <AppText
                    variant="bodyStrong"
                    weight={selected ? "800" : "700"}
                    style={styles.grow}
                  >
                    {category.name[language === "ar" ? "ar" : "en"]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <TextField
        label={t("support.create.descriptionLabel")}
        value={description}
        onChangeText={setDescription}
        maxLength={TICKET_DESCRIPTION_MAX}
        multiline
        textAlignVertical="top"
        testID="ticket-description"
      />

      <View style={styles.group}>
        <FieldLabel>
          {t("support.create.attachmentsLabel", {
            max: formatCount(TICKET_ATTACHMENTS_MAX, language),
          })}
        </FieldLabel>
        <View style={[styles.fileRow, flipRows && styles.rowReverse]}>
          {attachments.map((file, index) => (
            <View key={file.fileId} style={styles.fileFrame}>
              {file.isPdf ? (
                <View
                  style={[styles.file, styles.pdf]}
                  accessibilityLabel={t("support.create.attachment", {
                    n: formatCount(index + 1, language),
                  })}
                  testID={`ticket-attachment-${index}`}
                >
                  <Icon
                    name="document-text-outline"
                    size={20}
                    color={colors.textMuted}
                  />
                  <AppText
                    variant="caption"
                    weight="700"
                    color={colors.textMuted}
                    numberOfLines={1}
                  >
                    {file.name}
                  </AppText>
                </View>
              ) : (
                <Image
                  source={{ uri: file.uri }}
                  style={styles.file}
                  accessibilityLabel={t("support.create.attachment", {
                    n: formatCount(index + 1, language),
                  })}
                  testID={`ticket-attachment-${index}`}
                />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("support.create.removeAttachment", {
                  n: formatCount(index + 1, language),
                })}
                onPress={() => {
                  if (sending) return;
                  setAttachments((list) =>
                    list.filter((item) => item.fileId !== file.fileId),
                  );
                }}
                hitSlop={spacing.sm}
                style={[
                  styles.remove,
                  flipRows ? styles.removeStart : styles.removeEnd,
                ]}
                testID={`ticket-attachment-remove-${index}`}
              >
                <Icon name="close" size={16} color={colors.onAccent} />
              </Pressable>
            </View>
          ))}
          {attachments.length < TICKET_ATTACHMENTS_MAX ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("support.create.addAttachment")}
              accessibilityState={{ disabled: uploading, busy: uploading }}
              onPress={() => void addAttachment()}
              style={[styles.file, styles.addFile]}
              testID="ticket-add-attachment"
            >
              {uploading ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Icon name="add" size={24} color={colors.accent} />
              )}
            </Pressable>
          ) : null}
        </View>
        {uploadError ? (
          <FieldError testID="ticket-attachment-error">{t(uploadError)}</FieldError>
        ) : null}
      </View>

      <View style={styles.group}>
        <FieldLabel>{t("support.create.rideLabel")}</FieldLabel>
        {ride ? (
          <View style={styles.rideCard} testID="ticket-ride-selected">
            <ListRow
              icon="car-outline"
              title={tripLine(ride)}
              subtitle={formatMoney(ride.fareTotal, ride.currency, language)}
              last
            />
            <View style={[styles.rideActions, flipRows && styles.rowReverse]}>
              <TextButton
                title={t("support.create.changeRide")}
                onPress={() => {
                  setRide(null);
                  void openRidePick();
                }}
                testID="ticket-ride-change"
              />
              <TextButton
                title={t("support.create.removeRide")}
                onPress={() => {
                  setRide(null);
                  setRidePick({ status: "closed" });
                }}
                testID="ticket-ride-remove"
              />
            </View>
          </View>
        ) : null}
        {!ride && ridePick.status === "closed" ? (
          <TextButton
            title={t("support.create.linkRide")}
            onPress={() => void openRidePick()}
            testID="ticket-link-ride"
          />
        ) : null}
        {!ride && ridePick.status === "loading" ? (
          <LoadingState testID="ticket-rides-loading" />
        ) : null}
        {!ride && ridePick.status === "error" ? (
          <FieldError testID="ticket-rides-error">
            {t("support.create.ridesFailed")}
          </FieldError>
        ) : null}
        {!ride && ridePick.status === "open" ? (
          ridePick.trips.length === 0 ? (
            <AppText variant="secondary" color={colors.textMuted} testID="ticket-rides-empty">
              {t("support.create.noRides")}
            </AppText>
          ) : (
            <View testID="ticket-ride-options">
              {ridePick.trips.map((trip, index) => (
                <ListRow
                  key={trip.rideId}
                  icon="car-outline"
                  title={tripLine(trip)}
                  subtitle={formatMoney(trip.fareTotal, trip.currency, language)}
                  onPress={() => {
                    setRide(trip);
                    setRidePick({ status: "closed" });
                  }}
                  last={index === ridePick.trips.length - 1}
                  testID={`ticket-ride-option-${trip.rideId}`}
                />
              ))}
            </View>
          )
        ) : null}
      </View>

      {error ? (
        <Banner
          tone={error === "accountSuspended" ? "neutral" : "danger"}
          message={t(
            error === "accountSuspended"
              ? "trust.errors.accountSuspended"
              : `support.create.errors.${error}`,
          )}
          testID={`ticket-create-error-${error}`}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  center: { textAlign: "center" },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
  },
  optionSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  grow: { flex: 1 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: colors.accent },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  fileRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  rowReverse: { flexDirection: "row-reverse" },
  fileFrame: { width: 88, height: 88 },
  file: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
  },
  pdf: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 4,
  },
  addFile: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  remove: {
    position: "absolute",
    top: -spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.text,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  removeEnd: { right: -spacing.sm },
  removeStart: { left: -spacing.sm },
  rideCard: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    paddingHorizontal: spacing.md,
  },
  rideActions: {
    flexDirection: "row",
    gap: spacing.md,
  },
});
