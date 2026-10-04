package com.labby.backend.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.library.GeneralCodingRules;
import org.springframework.web.bind.annotation.RestController;

/**
 * Enforces the package-by-layer structure from docs/PROJECT-STRUCTURE.md. Adding a top-level
 * package requires updating {@link #CLASSES_LIVE_IN_ALLOWED_PACKAGES_ONLY} deliberately.
 */
@AnalyzeClasses(
    packages = LayeredArchitectureTest.BASE_PACKAGE,
    importOptions = ImportOption.DoNotIncludeTests.class)
public final class LayeredArchitectureTest {

  static final String BASE_PACKAGE = "com.labby.backend";

  @ArchTest
  static final ArchRule CLASSES_LIVE_IN_ALLOWED_PACKAGES_ONLY =
      classes()
          .should()
          .resideInAnyPackage(
              BASE_PACKAGE,
              BASE_PACKAGE + ".config..",
              BASE_PACKAGE + ".controller..",
              BASE_PACKAGE + ".dto..",
              BASE_PACKAGE + ".enums..",
              BASE_PACKAGE + ".exception..",
              BASE_PACKAGE + ".model..",
              BASE_PACKAGE + ".repository..",
              BASE_PACKAGE + ".runner..",
              BASE_PACKAGE + ".security..",
              BASE_PACKAGE + ".service..",
              BASE_PACKAGE + ".util..")
          .because("the top-level package list is a fixed allowlist");

  @ArchTest
  static final ArchRule NO_LAYER_ACCESSES_CONTROLLERS =
      noClasses()
          .that()
          .resideOutsideOfPackage("..controller..")
          .should()
          .dependOnClassesThat()
          .resideInAPackage("..controller..")
          .because("controllers are the outermost layer; nothing may depend on them")
          .allowEmptyShould(true);

  @ArchTest
  static final ArchRule REPOSITORIES_ACCESSED_ONLY_BY_SERVICES_AND_REPOSITORIES =
      classes()
          .that()
          .resideInAPackage("..repository..")
          .should()
          .onlyHaveDependentClassesThat()
          .resideInAnyPackage("..service..", "..repository..")
          .because("data access goes through the service layer")
          .allowEmptyShould(true);

  @ArchTest
  static final ArchRule DTOS_DO_NOT_DEPEND_ON_MODEL_OR_REPOSITORY =
      noClasses()
          .that()
          .resideInAPackage("..dto..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage("..model..", "..repository..")
          .because("DTOs are the API surface and must not leak persistence types")
          .allowEmptyShould(true);

  @ArchTest
  static final ArchRule REST_CONTROLLERS_ARE_NAMED_CONTROLLER =
      classes()
          .that()
          .areAnnotatedWith(RestController.class)
          .should()
          .haveSimpleNameEndingWith("Controller")
          .allowEmptyShould(true);

  @ArchTest
  static final ArchRule REPOSITORY_INTERFACES_ARE_NAMED_REPOSITORY =
      classes()
          .that()
          .resideInAPackage("..repository")
          .and()
          .areInterfaces()
          .and()
          .areAssignableTo(org.springframework.data.repository.Repository.class)
          .should()
          .haveSimpleNameEndingWith("Repository")
          .allowEmptyShould(true);

  @ArchTest
  static final ArchRule NO_FIELD_INJECTION =
      GeneralCodingRules.NO_CLASSES_SHOULD_USE_FIELD_INJECTION;
}
