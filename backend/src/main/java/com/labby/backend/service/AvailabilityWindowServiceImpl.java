package com.labby.backend.service;

import com.labby.backend.dto.AvailabilityWindowDto;
import com.labby.backend.dto.AvailabilityWindowsDto;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.model.AvailabilityWindow;
import com.labby.backend.repository.AvailabilityWindowRepository;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Weekly availability windows (DRV-05). The set is replaced at once; windows gate the claim board
 * and new claims only — never live offers (the online toggle does).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AvailabilityWindowServiceImpl implements AvailabilityWindowService {

  private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

  private final RideAccess rideAccess;
  private final AvailabilityWindowRepository availabilityWindowRepository;

  @Override
  @Transactional(readOnly = true)
  public AvailabilityWindowsDto get(UUID driverUserId) {
    rideAccess.requireDriver(driverUserId);
    return view(driverUserId);
  }

  @Override
  public AvailabilityWindowsDto replace(UUID driverUserId, AvailabilityWindowsDto request) {
    rideAccess.requireDriver(driverUserId);
    Set<String> seen = new HashSet<>();
    for (AvailabilityWindowDto window : request.windows()) {
      if (!seen.add(window.dayOfWeek() + "|" + window.startsAt() + "|" + window.endsAt())) {
        throw new InvalidRequestException("The same window is listed twice");
      }
    }
    availabilityWindowRepository.deleteAllOfDriver(driverUserId);
    availabilityWindowRepository.saveAllAndFlush(
        request.windows().stream()
            .map(
                window ->
                    AvailabilityWindow.builder()
                        .driverUserId(driverUserId)
                        .dayOfWeek(window.dayOfWeek().shortValue())
                        .startsAt(LocalTime.parse(window.startsAt(), HH_MM))
                        .endsAt(LocalTime.parse(window.endsAt(), HH_MM))
                        .build())
            .toList());
    return view(driverUserId);
  }

  private AvailabilityWindowsDto view(UUID driverUserId) {
    List<AvailabilityWindowDto> windows =
        availabilityWindowRepository
            .findByDriverUserIdOrderByDayOfWeekAscStartsAtAsc(driverUserId)
            .stream()
            .map(
                window ->
                    new AvailabilityWindowDto(
                        (int) window.getDayOfWeek(),
                        HH_MM.format(window.getStartsAt()),
                        HH_MM.format(window.getEndsAt())))
            .toList();
    return new AvailabilityWindowsDto(windows);
  }
}
