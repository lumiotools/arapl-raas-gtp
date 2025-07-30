# Rules and Regulations for Using the Warehouse Management System (Frontend)

## 1. General Usage
- Only authorized personnel may access and operate the system via the web interface. User accounts must not be shared.
- All actions performed in the frontend are logged for audit and security purposes.
- Users must comply with company policies and data privacy regulations when handling order, inventory, and product data.

## 2. Data Entry and Uploads
- All data uploads (orders, assignments, schedule mappings) must use the provided CSV or Excel templates. Do not modify column headers or formats.
- Before uploading, verify that all required fields are present and accurate:
  - Orders: `Order ID`, `Product Id`, `Qty`, `License Plate ID`
  - Assignments: `GTP Location`, `License Plate ID`
  - Schedule Mapping: `GTP Location`, `License Plate ID`
- Do not upload duplicate data in the system.
- If an upload fails, review the error message displayed in the UI and correct the file before retrying.

## 3. Inventory Management
- Only update inventory quantities through approved system workflows in the frontend. Manual changes are prohibited unless authorized by an administrator.
- All inventory movements (pick, drop, return) are recorded and visible in the system dashboard.
- Do not attempt to bypass system checks or validations when processing inventory.

## 4. Order Processing
- Orders must be created and managed through the system interface or approved upload endpoints.
- Do not manually alter order statuses or assignments outside the system.
- Ensure that all order items are correctly mapped to products and license plates.
- Only assign Pick locations to license plates that are available and not already assigned.

## 5. Station and Location Assignments
- Assignments of Pick locations, stations, and waiting locations must be performed using the correct UI sections and file formats.
- Do not assign the same Pick location to multiple license plates unless explicitly allowed by system rules.
- Always verify station and location availability before making assignments.

## 6. Skip and Partial Skip Conditions
- Do not skip or partially skip any task unless you have the required permissions and the products carried by the robots are confirmed to be defective or missing. Use only the provided UI controls for these actions.

## 7. Error Handling and Support
- If you encounter an error, review the error message shown in the frontend and consult the system documentation or support team.
- Do not attempt to fix system errors by editing the database directly.
- Report any suspicious activity, data inconsistencies, or system malfunctions to the administrator immediately.

## 8. Security and Confidentiality
- Do not share your login credentials or access tokens with others.
- Do not export, copy, or share sensitive data outside the system without proper authorization.
- All system access and actions are monitored; unauthorized use may result in disciplinary action.

## 9. System Updates and Maintenance
- Do not attempt to update, modify, or restart the system unless you are authorized and trained to do so.
- Follow all maintenance schedules and update notifications provided by the IT team.

## 10. Compliance
- All users must comply with company, legal, and regulatory requirements when using the system.
- Failure to follow these rules and regulations may result in loss of access, disciplinary action, or legal consequences.

## 11. Settings Section Functionality

- The **Settings** section allows users to:
  - Manage system configurations, including station setup and pick location assignments.
  - Add, edit, or remove stations and pick locations.
  - View and update inventory details.
  - Upload configuration files for bulk updates (stations, pick locations, inventory).
  - Review current assignments and system mappings.
  - Access audit logs and system status for configuration changes.
- All changes made in the configuration section are subject to validation and require appropriate permissions.


## 12. Workflow Overview

- Users log in to the system using their credentials.
- The dashboard provides access to analytics, robot movement, station status, and wait location analysis.
- Data uploads (orders, assignments, inventory) are performed via the **Actions** section, using the provided templates.
- Configuration changes (stations, pick locations, inventory and waiting locations) are managed in the **Settings** section.
- All actions, uploads, and changes are reflected in real-time in the dashboard and relevant UI sections.
- Error messages and notifications are displayed in the UI for user guidance.
---

**By using this system, you agree to abide by all rules and regulations outlined above. If you have any questions, contact your supervisor or system administrator.**