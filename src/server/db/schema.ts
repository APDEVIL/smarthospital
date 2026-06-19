import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["admin", "doctor", "receptionist", "patient"]);
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);
export const genderEnum = pgEnum("gender", ["male", "female", "other"]);
export const bloodGroupEnum = pgEnum("blood_group", [
  "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-",
]);
export const prescriptionStatusEnum = pgEnum("prescription_status", [
  "active",
  "completed",
  "cancelled",
]);

// ─── Better-Auth required tables ──────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  role: roleEnum("role").notNull().default("patient"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Domain tables ─────────────────────────────────────────────────────────────

export const department = pgTable("department", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const doctorProfile = pgTable("doctor_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id").references(() => department.id, {
    onDelete: "set null",
  }),
  specialization: text("specialization").notNull(),
  qualification: text("qualification").notNull(),
  licenseNumber: text("license_number").notNull().unique(),
  consultationFee: integer("consultation_fee").notNull().default(0), // in paise
  bio: text("bio"),
  isAvailable: boolean("is_available").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const doctorAvailability = pgTable("doctor_availability", {
  id: uuid("id").primaryKey().defaultRandom(),
  doctorId: uuid("doctor_id")
    .notNull()
    .references(() => doctorProfile.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sun … 6=Sat
  startTime: text("start_time").notNull(), // "09:00"
  endTime: text("end_time").notNull(),     // "17:00"
  slotDurationMinutes: integer("slot_duration_minutes").notNull().default(30),
  isActive: boolean("is_active").notNull().default(true),
});

export const patientProfile = pgTable("patient_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  dateOfBirth: date("date_of_birth"),
  gender: genderEnum("gender"),
  bloodGroup: bloodGroupEnum("blood_group"),
  phone: text("phone"),
  address: text("address"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  allergies: text("allergies"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const appointment = pgTable("appointment", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patientProfile.id, { onDelete: "cascade" }),
  doctorId: uuid("doctor_id")
    .notNull()
    .references(() => doctorProfile.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  status: appointmentStatusEnum("status").notNull().default("scheduled"),
  reason: text("reason"),
  notes: text("notes"),
  tokenNumber: integer("token_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const medicalRecord = pgTable("medical_record", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentId: uuid("appointment_id")
    .notNull()
    .unique()
    .references(() => appointment.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patientProfile.id, { onDelete: "cascade" }),
  doctorId: uuid("doctor_id")
    .notNull()
    .references(() => doctorProfile.id, { onDelete: "cascade" }),
  chiefComplaint: text("chief_complaint"),
  diagnosis: text("diagnosis"),
  symptoms: text("symptoms"),
  vitalSigns: text("vital_signs"), // JSON string: { bp, pulse, temp, weight }
  followUpDate: date("follow_up_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const prescription = pgTable("prescription", {
  id: uuid("id").primaryKey().defaultRandom(),
  medicalRecordId: uuid("medical_record_id")
    .notNull()
    .references(() => medicalRecord.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patientProfile.id, { onDelete: "cascade" }),
  medicationName: text("medication_name").notNull(),
  dosage: text("dosage").notNull(),
  frequency: text("frequency").notNull(),
  durationDays: integer("duration_days"),
  instructions: text("instructions"),
  status: prescriptionStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Relations ─────────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ one }) => ({
  doctorProfile: one(doctorProfile, {
    fields: [user.id],
    references: [doctorProfile.userId],
  }),
  patientProfile: one(patientProfile, {
    fields: [user.id],
    references: [patientProfile.userId],
  }),
}));

export const doctorProfileRelations = relations(doctorProfile, ({ one, many }) => ({
  user: one(user, { fields: [doctorProfile.userId], references: [user.id] }),
  department: one(department, {
    fields: [doctorProfile.departmentId],
    references: [department.id],
  }),
  availability: many(doctorAvailability),
  appointments: many(appointment),
  medicalRecords: many(medicalRecord),
}));

export const patientProfileRelations = relations(patientProfile, ({ one, many }) => ({
  user: one(user, { fields: [patientProfile.userId], references: [user.id] }),
  appointments: many(appointment),
  medicalRecords: many(medicalRecord),
  prescriptions: many(prescription),
}));

export const appointmentRelations = relations(appointment, ({ one }) => ({
  patient: one(patientProfile, {
    fields: [appointment.patientId],
    references: [patientProfile.id],
  }),
  doctor: one(doctorProfile, {
    fields: [appointment.doctorId],
    references: [doctorProfile.id],
  }),
  medicalRecord: one(medicalRecord, {
    fields: [appointment.id],
    references: [medicalRecord.appointmentId],
  }),
}));

export const medicalRecordRelations = relations(medicalRecord, ({ one, many }) => ({
  appointment: one(appointment, {
    fields: [medicalRecord.appointmentId],
    references: [appointment.id],
  }),
  patient: one(patientProfile, {
    fields: [medicalRecord.patientId],
    references: [patientProfile.id],
  }),
  doctor: one(doctorProfile, {
    fields: [medicalRecord.doctorId],
    references: [doctorProfile.id],
  }),
  prescriptions: many(prescription),
}));

export const prescriptionRelations = relations(prescription, ({ one }) => ({
  medicalRecord: one(medicalRecord, {
    fields: [prescription.medicalRecordId],
    references: [medicalRecord.id],
  }),
  patient: one(patientProfile, {
    fields: [prescription.patientId],
    references: [patientProfile.id],
  }),
}));