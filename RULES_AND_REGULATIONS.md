# Rules and Regulations for Using the Warehouse Management System

## 1. General Usage
- Only authorized personnel may access and operate the system via the web interface. User accounts must not be shared.
- All actions performed in the frontend are logged for audit and security purposes.
- Users must comply with company policies and data privacy regulations when handling order, inventory, and product data.

## 2. Data Entry and Uploads
- All data uploads (orders, assignments, inventory) must use the provided CSV or Excel templates. Do not modify column headers or formats.
- Before uploading, verify that all required fields are present and accurate:
  - Orders: `Order ID`, `Product Id`, `Qty`, `License Plate ID`
  - Assignments: `GTP Location`, `License Plate ID`
  - Inventory: `Inv Locations,Product ID,Qty,barcode_number`
- Do not upload duplicate data in the system.
- If an upload fails, review the error message displayed in the UI and correct the file before retrying.

## 3. Inventory Management
- Only update inventory quantities through approved system workflows in the frontend. Manual changes are prohibited unless authorized by an administrator.
- All inventory movements (pick, drop, return) are recorded and visible in the system dashboard.
- Do not attempt to bypass system checks or validations when processing inventory.

## 4. Order Processing
- Orders must be created and managed through the system interface or approved upload endpoints.
- Do not manually alter order statuses or assignments outside the system.
- Ensure that all license plates are correctly mapped to products and pick locations.

## 5. Station and Location Assignments
- Assignments of Pick locations, stations, and waiting locations must be performed using the correct UI sections and file formats.
- Appropriately choose the license plate numbers to process at each station and perform all operations according to that only.
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

- The **Settings** section is strictly accessible to administrators only.
- Any configuration changes in this section—such as adding or updating stations, pick locations, or waiting locations—must be handled with caution, as they can directly impact the overall performance of the application.
- The number of waiting locations should be at least equal to the number of stations configured in the system.
- All changes made in the configuration section are subject to validation and require appropriate permissions.


## 12. Workflow Overview

- Users log in to the system using their credentials.
- The dashboard provides access to analytics, robot movement, station status, and wait location analysis.
- Data uploads (orders, assignments, inventory) are performed via the **Actions** and **License Plate Mapping** section, using the provided templates.
- Configuration changes (stations, pick locations, inventory and waiting locations) are managed in the **Settings** section.
- All actions, uploads, and changes are reflected in real-time in the dashboard and relevant UI sections.
- Error messages and notifications are displayed in the UI for user guidance.
---

**By using this system, you agree to abide by all rules and regulations outlined above. If you have any questions, contact your supervisor or system administrator.**