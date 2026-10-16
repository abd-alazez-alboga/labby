package com.labby.backend.dto;

/** On a shared ride's offer (UC-D-13 step 1): seats taken at dispatch and the joined parties. */
public record SharedOfferInfoDto(int seats, int parties) {}
