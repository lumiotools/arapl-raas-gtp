# Rules and Regulations for Using the Warehouse Management System

## 1. General Usage
- Only authorized personnel may access and operate the system. User accounts must not be shared.
- All actions performed in the system are logged for audit and security purposes.
- Users must comply with company policies and data privacy regulations when handling order, inventory, and product data.

## 2. Data Entry and Uploads
- All data uploads (orders, assignments, schedule mappings) must use the provided CSV or Excel templates. Do not modify column headers or formats.
- Before uploading, verify that all required fields are present and accurate:
  - Orders: `Order ID`, `Product Id`, `Qty`, `License Plate ID`
  - Assignments: `GTP Location`,`License Plate ID`
  - Schedule Mapping: `GTP Location`, `License Plate ID`
- Do not upload duplicate data in the system.
- If an upload fails, review the error message and correct the file before retrying.

## 3. Inventory Management
- Only update inventory quantities through approved system workflows. Manual changes are prohibited unless authorized by an administrator.
- All inventory movements (pick, drop, return) is recorded in the system.
- Do not attempt to bypass system checks or validations when processing inventory.

## 4. Order Processing
- Orders must be created and managed through the system interface or approved upload endpoints.
- Do not manually alter order statuses or assignments outside the system.
- Ensure that all order items are correctly mapped to products and license plates.
- Only assign Pick locations to license plates that are available and not already assigned.

## 5. Station and Location Assignments
- Assignments of Pick locations, stations, and waiting locations must be performed using the correct endpoints and file formats.
- Do not assign the same Pick location to multiple license plates unless explicitly allowed by system rules.
- Always verify station and location availability before making assignments.

## 6. Task and Workflow Execution
- Do not manually trigger or skip tasks unless you have the required permissions.

## 7. Error Handling and Support
- If you encounter an error, review the error message and consult the system documentation or support team.
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

---

**By using this system, you agree to abide by all rules and regulations outlined above. If you have any questions, contact your supervisor or system administrator.**
