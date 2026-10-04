package com.labby.backend.repository;

import com.labby.backend.model.User;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Accounts; deletion is the {@code state} column, so finders see deleted rows too (USR-07). */
public interface UserRepository extends JpaRepository<User, UUID> {

  Optional<User> findByPhone(String phone);
}
