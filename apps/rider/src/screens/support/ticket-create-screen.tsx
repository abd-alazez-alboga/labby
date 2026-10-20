/**
 * Create a ticket (UC-S-19, SUP-01) — approved artboard S14TicketCreate:
 * admin-managed category list, description, up to 5 photo attachments
 * (uploaded as `ticket_attachment` the moment they are picked, like the
 * M11 report photos), and an optional link to one of the rider's rides.
 * Submitting opens the new ticket's thread. Opened from a suspension
 * (approved artboard V1FRiderSuspendedTicket, W39) it arrives pre-filled:
 * the `account_suspend` category selected when the server has it, the
 * description drafted (editable) and a note saying so.
 */
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ApiError, failureKind, type FailureKind } from "../../api/http-client";
import { listRides, type RideSummary } from "../../api/rides";
import { useOptionalAuth } from "../../auth/auth-context";
import {
  ACCOUNT_SUSPEND_CATEGORY,
  createTicket,
  listTicketCategories,
  localized,
  TICKET_ATTACHMENTS_MAX,
  TICKET_DESCRIPTION_MAX,
  uploadTicketFile,
  type TicketCategory,
} from "../../api/support";
import {
  AppText,
  Banner,
  ErrorView,
  LoadingView,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatDate } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { riderSuspension } from "../../trust/suspension";
import {
  suspensionTicketDescription,
  withFallbackReason,
} from "../../trust/suspension-ticket";

interface PickedFile {
  key: string;
  uri: string;
  fileId: string | null;
}

function uploadErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return "ticketCreate.errors.upload_too_large";
    if (error.status === 429) return "ticketCreate.errors.upload_limit";
  }
  return "ticketCreate.errors.upload_failed";
}

export default function TicketCreateScreen({
  initialRideId = null,
  aboutSuspension = null,
}: {
  initialRideId?: string | null;
  /**
   * Opened from "Contact support" on a suspension (W39); `reason` is the
   * refusal's `suspensionReason` for when the profile has none yet.
   */
  aboutSuspension?: { reason: string | null } | null;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const router = useRouter();
  const auth = useOptionalAuth();
  // The `account_suspend` category, when the server has it, is selected
  // once the list loads. The drafted description follows the profile (its
  // re-read may bring the admin's note) until the rider edits it.
  const initialCategoryCode = aboutSuspension ? ACCOUNT_SUSPEND_CATEGORY : null;
  const draft = aboutSuspension
    ? suspensionTicketDescription(
        withFallbackReason(
          riderSuspension(auth?.user ?? null, auth?.suspensionSignal ?? null),
          aboutSuspension.reason,
        ),
        t,
      )
    : "";
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [rides, setRides] = useState<RideSummary[]>([]);
  // The ride link is optional: a failed ride history only hides the picker.
  const [ridesFailed, setRidesFailed] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [failure, setFailure] = useState<FailureKind>("network");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // null = untouched: the draft shows.
  const [edited, setDescription] = useState<string | null>(null);
  const description = edited ?? draft;
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rideId, setRideId] = useState<string | null>(initialRideId);
  const [ridePickerOpen, setRidePickerOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(0);

  const load = useCallback(async () => {
    setStatus("loading");
    const history = listRides(0).then(
      (page) => {
        setRides(page.items);
        setRidesFailed(false);
      },
      () => setRidesFailed(true),
    );
    try {
      const list = await listTicketCategories();
      setCategories(list);
      if (initialCategoryCode) {
        // The rider's own pick wins over the pre-selection on a reload.
        const preset = list.find(
          (category) => category.systemCode === initialCategoryCode,
        );
        setCategoryId((current) => current ?? preset?.ticketCategoryId ?? null);
      }
      await history;
      setStatus("ready");
    } catch (error) {
      setFailure(failureKind(error));
      setStatus("error");
    }
  }, [initialCategoryCode]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const addFile = async () => {
    if (files.length >= TICKET_ATTACHMENTS_MAX) return;
    setFileError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const key = `file-${nextKey.current++}`;
    setFiles((list) =>
      list.length >= TICKET_ATTACHMENTS_MAX
        ? list
        : [...list, { key, uri: asset.uri, fileId: null }],
    );
    try {
      const uploaded = await uploadTicketFile(
        {
          uri: asset.uri,
          name: asset.fileName ?? "attachment.jpg",
          type: asset.mimeType ?? "image/jpeg",
        },
        "ticket_attachment",
      );
      setFiles((list) =>
        list.map((file) =>
          file.key === key ? { ...file, fileId: uploaded.fileId } : file,
        ),
      );
    } catch (error) {
      setFiles((list) => list.filter((file) => file.key !== key));
      setFileError(t(uploadErrorKey(error)));
    }
  };

  const uploading = files.some((file) => file.fileId === null);
  const linkedRide = rides.find((ride) => ride.id === rideId) ?? null;

  const send = async () => {
    if (busy || uploading) return;
    if (!categoryId) {
      setSendError(t("ticketCreate.errors.category_required"));
      return;
    }
    const text = description.trim();
    if (!text) {
      setSendError(t("ticketCreate.errors.description_required"));
      return;
    }
    setBusy(true);
    setSendError(null);
    try {
      const ticket = await createTicket({
        categoryId,
        description: text,
        rideId,
        attachmentFileIds: files
          .map((file) => file.fileId)
          .filter((id): id is string => id !== null),
      });
      router.replace(`/ticket/${encodeURIComponent(ticket.ticketId)}` as never);
    } catch (error) {
      const code = error instanceof ApiError ? (error.body?.code ?? null) : null;
      setSendError(
        code === "category_inactive"
          ? t("ticketCreate.errors.category_inactive")
          : t("ticketCreate.errors.generic"),
      );
      if (code === "category_inactive") void load();
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") return <LoadingView testID="ticket-create-loading" />;
  if (status === "error") {
    return <ErrorView kind={failure} onRetry={() => void load()} />;
  }

  const rideLine = (ride: RideSummary) =>
    [
      formatDate(ride.requestedAt, locale),
      ride.destination.label,
      ride.counterpartFirstName ?? null,
    ]
      .filter((part): part is string => !!part)
      .join(" · ");

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      keyboardShouldPersistTaps="handled"
      testID="ticket-create"
    >
      {aboutSuspension ? (
        <Banner
          tone="accent"
          message={t("suspended.ticket.notice")}
          testID="ticket-create-notice"
        />
      ) : null}
      <View style={styles.group}>
        <AppText variant="label" weight={700} tone="secondary">
          {t("ticketCreate.categoryLabel")}
        </AppText>
        {categories.map((category) => {
          const selected = category.ticketCategoryId === categoryId;
          return (
            <Pressable
              key={category.ticketCategoryId}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={localized(category.name, locale)}
              onPress={() => setCategoryId(category.ticketCategoryId)}
              style={[
                styles.choice,
                { flexDirection: row },
                selected ? styles.choiceSelected : styles.choiceIdle,
              ]}
              testID={`ticket-category-${category.ticketCategoryId}`}
            >
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={22}
                color={selected ? colors.accent : colors.textMuted}
              />
              <AppText variant="bodyStrong" weight={selected ? 800 : 700}>
                {localized(category.name, locale)}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <TextField
        label={t("ticketCreate.descriptionLabel")}
        value={description}
        onChangeText={setDescription}
        maxLength={TICKET_DESCRIPTION_MAX}
        multiline
        style={styles.description}
        testID="ticket-description"
      />

      <View style={styles.group}>
        <AppText variant="label" weight={700} tone="secondary">
          {t("ticketCreate.attachmentsLabel")}{" "}
          <AppText variant="label" tone="muted">
            · {t("ticketCreate.attachmentsHint")}
          </AppText>
        </AppText>
        <View style={[styles.tiles, { flexDirection: row }]}>
          {files.map((file) => (
            <View key={file.key} style={styles.tile} testID="ticket-attachment">
              <Image source={{ uri: file.uri }} style={styles.thumb} />
              {file.fileId === null ? (
                <View style={styles.tileBusy}>
                  <ActivityIndicator
                    color={colors.accent}
                    testID="ticket-attachment-uploading"
                  />
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("ticketCreate.removeAttachment")}
                hitSlop={13}
                onPress={() =>
                  setFiles((list) => list.filter((f) => f.key !== file.key))
                }
                style={styles.remove}
                testID={`ticket-attachment-remove-${file.key}`}
              >
                <Ionicons name="close" size={14} color={colors.onAccent} />
              </Pressable>
            </View>
          ))}
          {files.length < TICKET_ATTACHMENTS_MAX ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("ticketCreate.addAttachment")}
              onPress={() => void addFile()}
              style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
              testID="ticket-add-attachment"
            >
              <Ionicons name="add" size={26} color={colors.accent} />
            </Pressable>
          ) : null}
        </View>
        {fileError ? (
          <Banner tone="danger" message={fileError} testID="ticket-file-error" />
        ) : null}
      </View>

      {ridesFailed ? null : (
        <View style={styles.group} testID="ticket-ride-section">
          <AppText variant="label" weight={700} tone="secondary">
            {t("ticketCreate.rideLabel")}{" "}
            <AppText variant="label" tone="muted">
              · {t("ticketCreate.rideOptional")}
            </AppText>
          </AppText>
          {linkedRide ? (
            <View
              style={[styles.rideCard, { flexDirection: row }]}
              testID="ticket-ride-linked"
            >
              <View style={styles.rideIcon}>
                <Ionicons name="car-outline" size={18} color={colors.accent} />
              </View>
              <AppText variant="secondary" weight={700} style={styles.flex}>
                {rideLine(linkedRide)}
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRideId(null)}
                style={styles.rideRemove}
                testID="ticket-ride-remove"
              >
                <AppText variant="caption" weight={800} tone="accent">
                  {t("ticketCreate.rideRemove")}
                </AppText>
              </Pressable>
            </View>
          ) : null}
          {ridePickerOpen ? (
            <View testID="ticket-ride-picker">
              {rides.map((ride, index) => (
                <Pressable
                  key={ride.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setRideId(ride.id);
                    setRidePickerOpen(false);
                  }}
                  style={[
                    styles.rideRow,
                    { flexDirection: row },
                    index < rides.length - 1 && styles.rideRowLine,
                  ]}
                  testID={`ticket-ride-${ride.id}`}
                >
                  <AppText variant="secondary" weight={600} style={styles.flex}>
                    {rideLine(ride)}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setRidePickerOpen(true)}
              style={[styles.rideSelect, { flexDirection: row }]}
              testID="ticket-ride-open"
            >
              <AppText variant="secondary" weight={700} tone="accent">
                {linkedRide
                  ? t("ticketCreate.rideChange")
                  : t("ticketCreate.rideNone")}
              </AppText>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.footer}>
        {sendError ? (
          <Banner tone="danger" message={sendError} testID="ticket-send-error" />
        ) : null}
        <PrimaryButton
          label={t("ticketCreate.submit")}
          onPress={() => void send()}
          disabled={uploading}
          loading={busy}
          testID="ticket-send"
        />
        <AppText variant="caption" tone="muted" weight={400} align="center">
          {t("ticketCreate.footnote")}
        </AppText>
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  choice: {
    minHeight: 52,
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    paddingHorizontal: spacing.lg,
  },
  choiceSelected: {
    borderColor: colors.accent,
  },
  choiceIdle: {
    borderColor: colors.line,
  },
  description: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  tiles: {
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  tile: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMap,
  },
  thumb: {
    width: "100%",
    height: "100%",
    borderRadius: radius.sm,
  },
  tileBusy: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
    borderRadius: radius.sm,
  },
  remove: {
    position: "absolute",
    top: -6,
    end: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
  rideCard: {
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rideIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  rideRemove: {
    minHeight: 48,
    justifyContent: "center",
  },
  rideSelect: {
    minHeight: 48,
    alignItems: "center",
  },
  rideRow: {
    minHeight: 56,
    alignItems: "center",
    gap: spacing.md,
  },
  rideRowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  flex: {
    flex: 1,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
});
