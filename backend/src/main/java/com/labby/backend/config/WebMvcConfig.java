package com.labby.backend.config;

import com.labby.backend.security.AccountSuspensionInterceptor;
import com.labby.backend.service.SuspensionService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers the M11 whole-account suspension gate on the rider/driver feature paths (USR-06). The
 * service is looked up lazily: web-layer test slices ({@code @WebMvcTest}) have no service beans,
 * so they run without the gate; the full application always has it.
 */
@Configuration
@RequiredArgsConstructor
public class WebMvcConfig implements WebMvcConfigurer {

  private final ObjectProvider<SuspensionService> suspensionService;

  @Override
  public void addInterceptors(@NonNull InterceptorRegistry registry) {
    SuspensionService service = suspensionService.getIfAvailable();
    if (service != null) {
      registry
          .addInterceptor(new AccountSuspensionInterceptor(service))
          .addPathPatterns(AccountSuspensionInterceptor.FEATURE_PATHS);
    }
  }
}
